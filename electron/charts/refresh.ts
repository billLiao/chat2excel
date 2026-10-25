/**
 * Deterministic chart authoring and refresh.
 *
 * Authoring runs once (pin). Refresh replays the saved SQL and recompiles the
 * saved encoding; no model call is involved. Every dashboard item fails in
 * isolation so one broken query cannot blank the whole dashboard.
 */

import { randomUUID } from 'node:crypto';
import type {
    ChartColumn,
    ChartDefinition,
    ChartPayload,
    ChartRebuildInput,
    ChartRefreshItemResult,
    ChartSnapshot,
    ChartSpec,
    ChartUpdateInput,
    ChartUpdateResult,
    DashboardFilter,
    DashboardRefreshResult,
    PinChartInput,
    PinChartResult,
} from '../../src/lib/charts/types';
import { db } from '../db';
import { rowsToObjects, type QueryArtifact } from '../agent/result-store';
import {
    buildChartFromRows,
    buildChartFromSpec,
    chartFingerprint,
    stableSqlHash,
} from './compiler';
import { applyFiltersToSql, filterCacheKey } from './filters';
import {
    addChartToDashboard,
    ensureDashboard,
    findChartByFingerprint,
    getChart,
    getDashboard,
    markChartRefresh,
    saveChart,
    updateChart,
} from './store';

const MAX_REFRESH_ROWS = 10_000;
const DEFAULT_TTL_SECONDS = 30;
const MAX_CACHE_ENTRIES = 100;
const SNAPSHOT_ROW_LIMIT = 2_000;

interface CacheEntry {
    at: number;
    dataVersion: number;
    chart: ChartPayload;
}

const chartCache = new Map<string, CacheEntry>();

/** Cache entries are keyed by chart id plus the active filter set. */
function cacheKey(chartId: string, filters?: DashboardFilter[]): string {
    const filterKey = filterCacheKey(filters);
    return filterKey ? `${chartId}|${filterKey}` : chartId;
}

export function invalidateChartCache(chartId?: string): void {
    if (!chartId) {
        chartCache.clear();
        return;
    }
    for (const key of Array.from(chartCache.keys())) {
        if (key === chartId || key.startsWith(`${chartId}|`)) {
            chartCache.delete(key);
        }
    }
}

function remember(chartId: string, chart: ChartPayload, dataVersion: number, filters?: DashboardFilter[]): void {
    chartCache.set(cacheKey(chartId, filters), { at: Date.now(), dataVersion, chart });
    while (chartCache.size > MAX_CACHE_ENTRIES) {
        const oldest = chartCache.keys().next().value;
        if (oldest === undefined) return;
        chartCache.delete(oldest);
    }
}

function snapshotFromArtifact(
    artifact: QueryArtifact,
    dataVersion: number
): ChartSnapshot {
    return {
        columns: artifact.columns,
        rows: artifact.rows.slice(0, SNAPSHOT_ROW_LIMIT),
        rowCount: artifact.rowCount,
        capturedAt: Date.now(),
        dataVersion,
    };
}

function snapshotArtifact(definition: ChartDefinition): QueryArtifact {
    const snapshot = definition.snapshot;
    if (!snapshot) {
        throw new Error('这个图表是快照模式，但快照数据缺失。请手动刷新一次。');
    }
    return {
        id: `snapshot_${definition.id}`,
        sql: definition.query.sql,
        tables: definition.query.tables,
        columns: snapshot.columns,
        rows: snapshot.rows,
        rowCount: snapshot.rowCount,
        truncated: snapshot.rowCount > snapshot.rows.length,
        elapsedMs: 0,
        createdAt: snapshot.capturedAt,
    };
}

function failure(
    chartId: string,
    message: string,
    definition: ChartDefinition | null,
    refreshedAt = Date.now()
): ChartRefreshItemResult {
    return {
        chartId,
        success: false,
        error: message,
        definition: definition || undefined,
        refreshedAt,
    };
}

/**
 * Refresh one chart. `force` bypasses the cache and, for snapshot charts,
 * recaptures the stored rows. `filters` push dashboard-level conditions onto
 * the replayed SQL; snapshot charts ignore them because their rows are frozen.
 */
export async function refreshChart(
    chartId: string,
    options: { force?: boolean; filters?: DashboardFilter[] } = {}
): Promise<ChartRefreshItemResult> {
    const definition = getChart(chartId);
    if (!definition) {
        return failure(chartId, '图表定义不存在，可能已被删除。', null);
    }

    const dataVersion = db.getDataVersion();
    const force = options.force === true;
    // Snapshot charts serve frozen rows; filters would silently change their
    // meaning, so they are only honored for live charts.
    const filters =
        definition.refresh.mode === 'live' && options.filters?.length ? options.filters : undefined;
    const key = cacheKey(chartId, filters);

    if (definition.query.sqlHash !== stableSqlHash(definition.query.sql)) {
        const message = '图表定义校验失败：保存的查询已被修改。请重新生成并订阅。';
        markChartRefresh(chartId, {
            at: Date.now(),
            status: 'error',
            error: message,
            dataVersion,
        });
        return failure(chartId, message, definition);
    }

    if (definition.refresh.mode === 'snapshot' && definition.snapshot && !force) {
        try {
            const artifact = snapshotArtifact(definition);
            const chart = buildChartFromSpec(artifact, definition.spec, {
                queryId: artifact.id,
                title: definition.title,
                explanation: definition.description,
                sql: definition.query.sql,
                tables: definition.query.tables,
                datasetIds: definition.datasetIds,
                theme: definition.spec.theme,
            });
            return {
                chartId,
                success: true,
                chart,
                definition,
                cached: true,
                refreshedAt: definition.snapshot.capturedAt,
            };
        } catch (error: any) {
            return failure(chartId, error.message || String(error), definition);
        }
    }

    const ttl = Math.max(0, definition.refresh.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    const cached = chartCache.get(key);
    if (
        !force &&
        cached &&
        cached.dataVersion === dataVersion &&
        Date.now() - cached.at <= ttl
    ) {
        return {
            chartId,
            success: true,
            chart: cached.chart,
            definition,
            cached: true,
            refreshedAt: cached.at,
        };
    }

    try {
        const datasets = await db.getDatasets();
        const missing = definition.datasetIds.filter(
            (id) => !datasets.some((dataset) => dataset.id === id)
        );
        if (missing.length > 0) {
            throw new Error('图表依赖的数据集已被删除，请重新导入数据并订阅该图表。');
        }

        let sql = definition.query.sql;
        if (filters?.length) {
            const filtered = await applyFiltersToSql(definition.query.sql, filters, (describeSql) =>
                db.execute(describeSql)
            );
            sql = filtered.sql;
        }

        const artifact = await db.query(sql, {
            maxRows: MAX_REFRESH_ROWS,
            timeoutMs: 30_000,
        });

        const chart = buildChartFromSpec(artifact, definition.spec, {
            queryId: artifact.id,
            title: definition.title,
            explanation: definition.description,
            sql: definition.query.sql,
            tables: definition.query.tables,
            datasetIds: definition.datasetIds,
            theme: definition.spec.theme,
        });
        if (filters?.length) chart.chartId = chartId;

        // A filtered refresh is a view, not the chart's own state: keep the
        // persisted lastRefresh/snapshot pinned to the unfiltered replay.
        const snapshot =
            definition.refresh.mode === 'snapshot'
                ? snapshotFromArtifact(artifact, dataVersion)
                : undefined;
        if (!filters?.length) {
            updateChart(
                chartId,
                {
                    ...(snapshot ? { snapshot } : {}),
                    lastRefresh: {
                        at: Date.now(),
                        status: 'ok',
                        rowCount: artifact.rowCount,
                        dataVersion,
                    },
                    touch: false,
                }
            );
        }

        remember(chartId, chart, dataVersion, filters);
        return {
            chartId,
            success: true,
            chart,
            definition,
            cached: false,
            refreshedAt: Date.now(),
        };
    } catch (error: any) {
        const message = error?.message || String(error);
        const refreshed = markChartRefresh(chartId, {
            at: Date.now(),
            status: 'error',
            error: message,
            dataVersion,
        });
        return failure(chartId, message, refreshed || definition);
    }
}

export async function refreshDashboard(
    dashboardId: string,
    options: { force?: boolean; filters?: DashboardFilter[] } = {}
): Promise<DashboardRefreshResult> {
    const dashboard = getDashboard(dashboardId);
    if (!dashboard) throw new Error('仪表盘不存在或已被删除。');

    const filters = options.filters ?? dashboard.filters ?? [];
    const refreshedAt = Date.now();
    const items = await Promise.all(
        dashboard.items.map(async (item) => {
            try {
                return await refreshChart(item.chartId, { ...options, filters });
            } catch (error: any) {
                return failure(item.chartId, error?.message || String(error), null, refreshedAt);
            }
        })
    );
    return {
        dashboardId,
        refreshedAt,
        items,
    };
}

/**
 * Author a saved chart from the UI (editor / repair) without the model.
 *
 * The (possibly replaced) SQL is replayed and the merged spec is re-normalized
 * against the fresh rows, so an invalid edit throws before anything persists.
 */
export async function updateChartSpec(input: ChartUpdateInput): Promise<ChartUpdateResult> {
    const definition = getChart(input.chartId);
    if (!definition) {
        throw new Error('图表定义不存在，可能已被删除。');
    }

    const sql = input.sql?.trim() || definition.query.sql;
    if (!sql) {
        throw new Error('图表缺少可执行的 SQL。');
    }

    const artifact = await db.query(sql, {
        maxRows: MAX_REFRESH_ROWS,
        timeoutMs: 30_000,
    });

    const mergedSpec: Partial<ChartSpec> = { ...definition.spec, ...(input.spec || {}) };
    const built = buildChartFromSpec(artifact, mergedSpec, {
        queryId: artifact.id,
        title: input.title?.trim() || definition.title,
        explanation: input.description?.trim() ?? definition.description,
        sql,
        tables: artifact.tables,
        datasetIds: definition.datasetIds,
        theme: mergedSpec.theme,
    });

    // Recompute dataset ids: a repaired SQL may point at different tables.
    const datasets = await db.getDatasets();
    const artifactTables = new Set(artifact.tables.map((table) => table.toLowerCase()));
    const stillValid = definition.datasetIds.filter((id) => {
        const dataset = datasets.find((entry) => entry.id === id);
        return dataset && artifactTables.has(dataset.physicalName.toLowerCase());
    });
    const datasetIds = stillValid.length
        ? stillValid
        : datasets
              .filter((dataset) => artifactTables.has(dataset.physicalName.toLowerCase()))
              .map((dataset) => dataset.id);

    const now = Date.now();
    const dataVersion = db.getDataVersion();
    const patch: Parameters<typeof updateChart>[1] = {
        datasetIds,
        query: {
            kind: 'sql',
            sql,
            sqlHash: stableSqlHash(sql),
            tables: artifact.tables,
        },
        spec: built.spec,
        fingerprint: chartFingerprint(sql, built.spec),
        lastRefresh: {
            at: now,
            status: 'ok',
            rowCount: artifact.rowCount,
            dataVersion,
        },
    };
    if (input.title?.trim()) patch.title = input.title.trim();
    if (typeof input.description === 'string') patch.description = input.description.trim() || undefined;
    if (definition.refresh.mode === 'snapshot') {
        patch.snapshot = snapshotFromArtifact(artifact, dataVersion);
    }

    const updated = updateChart(input.chartId, patch);
    invalidateChartCache(input.chartId);
    return {
        definition: updated || definition,
        chart: { ...built, chartId: input.chartId },
    };
}

/**
 * Rebuild a chart payload without persisting anything: either by refreshing a
 * saved definition (cache-aware) or by replaying ad-hoc SQL + spec metadata.
 * Used to hydrate chat history after a restart.
 */
export async function rebuildChartPayload(input: ChartRebuildInput): Promise<ChartPayload> {
    if (input.chartId) {
        const result = await refreshChart(input.chartId);
        if (result.success && result.chart) {
            return { ...result.chart, chartId: input.chartId };
        }
        throw new Error(result.error || '图表刷新失败。');
    }

    const sql = input.sql?.trim();
    if (!sql) {
        throw new Error('这个图表缺少查询元数据，无法在重启后重建。请重新生成或订阅该图表。');
    }
    const artifact = await db.query(sql, {
        maxRows: MAX_REFRESH_ROWS,
        timeoutMs: 30_000,
    });
    const chart = buildChartFromSpec(artifact, input.spec || { chartType: 'bar', y: [] }, {
        queryId: artifact.id,
        title: input.title,
        explanation: input.explanation,
        sql,
        tables: artifact.tables,
        theme: input.theme,
    });
    return chart;
}

function fallbackSpecFromPayload(
    payload: PinChartInput['chart']
): Parameters<typeof buildChartFromSpec>[1] {
    return {
        chartType: payload.chartType || 'bar',
        x: payload.encoding?.x,
        y: payload.encoding?.y?.length
            ? payload.encoding.y
            : payload.spec?.y?.length
              ? payload.spec.y
              : [],
        series: payload.encoding?.series || payload.spec?.series,
        size: payload.encoding?.size || payload.spec?.size,
        aggregate: payload.spec?.aggregate || 'sum',
    };
}

/**
 * Persist a chart shown in chat. The SQL is re-validated and executed once so
 * a broken chart is never added to a dashboard.
 */
export async function pinChart(input: PinChartInput): Promise<PinChartResult> {
    const payload = input.chart;
    if (!payload) {
        throw new Error('没有可订阅的图表。');
    }
    if (!payload.sql || !payload.sql.trim()) {
        throw new Error('这个图表没有保存查询元数据，请让 AI 重新生成图表后再订阅。');
    }
    if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
        throw new Error('图表缺少列信息，请重新生成图表。');
    }

    const sql = payload.sql.trim();
    const artifact = await db.query(sql, {
        maxRows: MAX_REFRESH_ROWS,
        timeoutMs: 30_000,
    });

    const datasets = await db.getDatasets();
    const knownIds = new Set(datasets.map((dataset) => dataset.id));
    const artifactTables = new Set(artifact.tables.map((table) => table.toLowerCase()));
    const inferredDatasetIds = datasets
        .filter((dataset) => artifactTables.has(dataset.physicalName.toLowerCase()))
        .map((dataset) => dataset.id);
    const providedIds = Array.isArray(payload.datasetIds)
        ? payload.datasetIds.filter((id) => knownIds.has(id))
        : [];
    const datasetIds =
        providedIds.length > 0 ? providedIds : inferredDatasetIds;

    const initialSpec = payload.spec || fallbackSpecFromPayload(payload);
    const built = buildChartFromSpec(artifact, initialSpec, {
        title: payload.title,
        explanation: payload.explanation,
        sql,
        tables: artifact.tables,
        datasetIds,
        queryId: artifact.id,
        theme: payload.theme,
    });

    // Recompile once with the normalized spec so the persisted definition is
    // exactly what a later refresh will produce.
    const normalized = buildChartFromSpec(artifact, built.spec, {
        title: payload.title,
        explanation: payload.explanation,
        sql,
        tables: artifact.tables,
        datasetIds,
        queryId: artifact.id,
        theme: payload.theme,
    });

    const fingerprint = chartFingerprint(sql, normalized.spec);
    const existing = findChartByFingerprint(fingerprint);
    const now = Date.now();
    const dataVersion = db.getDataVersion();
    const mode = input.mode || existing?.refresh.mode || 'live';

    const definition: ChartDefinition = existing
        ? updateChart(
              existing.id,
              {
                  title: input.titleOverride?.trim() || existing.title,
                  description: input.description ?? existing.description,
                  refresh: {
                      ...existing.refresh,
                      mode,
                      auto: input.auto ?? existing.refresh.auto,
                  },
                  snapshot:
                      mode === 'snapshot'
                          ? snapshotFromArtifact(artifact, dataVersion)
                          : undefined,
                  lastRefresh: {
                      at: now,
                      status: 'ok',
                      rowCount: artifact.rowCount,
                      dataVersion,
                  },
                  provenance: input.provenance || existing.provenance,
              }
          )!
        : {
              id: `chart_${randomUUID()}`,
              title: input.titleOverride?.trim() || payload.title || normalized.title,
              description: input.description?.trim() || payload.explanation,
              datasetIds,
              query: {
                  kind: 'sql',
                  sql,
                  sqlHash: stableSqlHash(sql),
                  tables: artifact.tables,
              },
              spec: normalized.spec,
              refresh: {
                  mode,
                  auto: input.auto ?? false,
                  ttlSeconds: DEFAULT_TTL_SECONDS,
              },
              snapshot:
                  mode === 'snapshot'
                      ? snapshotFromArtifact(artifact, dataVersion)
                      : undefined,
              provenance: input.provenance,
              fingerprint,
              version: 1,
              createdAt: now,
              updatedAt: now,
              lastRefresh: {
                  at: now,
                  status: 'ok',
                  rowCount: artifact.rowCount,
                  dataVersion,
              },
          };

    if (!existing) saveChart(definition);

    const target = ensureDashboard({
        dashboardId: input.dashboardId,
        dashboardName: input.dashboardName,
    });
    const added = addChartToDashboard(target.id, definition.id, {
        titleOverride: input.titleOverride,
    });
    remember(definition.id, normalized, dataVersion);

    return {
        chart: definition,
        dashboard: added.dashboard,
        item: added.item,
        reused: !!existing,
    };
}

/** Rebuild a chart payload from an explicit set of rows (used by tests/tools). */
export function compileFromRows(
    columns: ChartColumn[],
    rows: Record<string, unknown>[],
    spec: Parameters<typeof buildChartFromRows>[2],
    title?: string
): ChartPayload {
    return buildChartFromRows(columns, rows, spec, { title });
}

/** Exposed for diagnostics: row objects are only used internally. */
export function snapshotRows(definition: ChartDefinition): Record<string, unknown>[] {
    return definition.snapshot ? rowsToObjects(snapshotArtifact(definition)) : [];
}
