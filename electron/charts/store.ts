/**
 * Persistent chart definitions and dashboards.
 *
 * Definitions store the query + encoding, never rows or ECharts JSON (apart
 * from an optional explicit snapshot). Dashboards only reference chart IDs and
 * carry grid layout, so the same chart can appear in several dashboards.
 */

import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type {
    ChartDefinition,
    Dashboard,
    DashboardItem,
} from '../../src/lib/charts/types';
import {
    DEFAULT_ITEM_HEIGHT,
    DEFAULT_ITEM_WIDTH,
    clamp,
    compactLayout,
    findFreeSlot,
    normalizeRect,
} from '../../src/lib/charts/layout';

interface ChartsStoreSchema {
    charts: ChartDefinition[];
    dashboards: Dashboard[];
}

const store = new Store<ChartsStoreSchema>({
    name: 'dashboards',
    defaults: {
        charts: [],
        dashboards: [],
    },
});

const DEFAULT_DASHBOARD_NAME = '我的仪表盘';

function readCharts(): ChartDefinition[] {
    const charts = store.get('charts');
    return Array.isArray(charts) ? charts : [];
}

function writeCharts(charts: ChartDefinition[]): void {
    store.set('charts', charts);
}

const DASHBOARDS_SCHEMA_VERSION = 1;

function readDashboards(): Dashboard[] {
    const dashboards = store.get('dashboards');
    if (!Array.isArray(dashboards)) return [];
    // One-off migration: stamp the schema version onto stores created before
    // it existed so future field changes can migrate deterministically.
    let migrated = false;
    for (const dashboard of dashboards) {
        if (dashboard && typeof dashboard === 'object' && dashboard.schemaVersion === undefined) {
            dashboard.schemaVersion = DASHBOARDS_SCHEMA_VERSION;
            migrated = true;
        }
    }
    if (migrated) store.set('dashboards', dashboards);
    return dashboards;
}

function writeDashboards(dashboards: Dashboard[]): void {
    store.set('dashboards', dashboards);
}

export function listCharts(): ChartDefinition[] {
    return [...readCharts()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getChart(chartId: string): ChartDefinition | null {
    return readCharts().find((chart) => chart.id === chartId) || null;
}

export function findChartByFingerprint(fingerprint: string): ChartDefinition | null {
    return readCharts().find((chart) => chart.fingerprint === fingerprint) || null;
}

export function saveChart(definition: ChartDefinition): ChartDefinition {
    const charts = readCharts();
    const index = charts.findIndex((chart) => chart.id === definition.id);
    if (index >= 0) {
        charts[index] = definition;
    } else {
        charts.unshift(definition);
    }
    writeCharts(charts);
    return definition;
}

export function updateChart(
    chartId: string,
    patch: Partial<ChartDefinition> & { touch?: boolean }
): ChartDefinition | null {
    const charts = readCharts();
    const index = charts.findIndex((chart) => chart.id === chartId);
    if (index < 0) return null;
    const { touch, ...rest } = patch;
    charts[index] = {
        ...charts[index],
        ...rest,
        version: charts[index].version + 1,
        updatedAt: touch === false ? charts[index].updatedAt : Date.now(),
    };
    writeCharts(charts);
    return charts[index];
}

/** Refresh metadata changes without bumping the authoring version. */
export function markChartRefresh(
    chartId: string,
    lastRefresh: ChartDefinition['lastRefresh']
): ChartDefinition | null {
    const charts = readCharts();
    const index = charts.findIndex((chart) => chart.id === chartId);
    if (index < 0) return null;
    charts[index] = { ...charts[index], lastRefresh };
    writeCharts(charts);
    return charts[index];
}

export function deleteChart(chartId: string): boolean {
    const charts = readCharts();
    const filtered = charts.filter((chart) => chart.id !== chartId);
    if (filtered.length === charts.length) return false;
    writeCharts(filtered);

    const dashboards = readDashboards().map((dashboard) => ({
        ...dashboard,
        items: dashboard.items.filter((item) => item.chartId !== chartId),
        updatedAt: Date.now(),
        version: dashboard.version + 1,
    }));
    writeDashboards(dashboards);
    return true;
}

export function listDashboards(): Dashboard[] {
    return [...readDashboards()].sort((a, b) => a.createdAt - b.createdAt);
}

export function getDashboard(dashboardId: string): Dashboard | null {
    return readDashboards().find((dashboard) => dashboard.id === dashboardId) || null;
}

export function saveDashboard(dashboard: Dashboard): Dashboard {
    const dashboards = readDashboards();
    const index = dashboards.findIndex((item) => item.id === dashboard.id);
    if (index >= 0) dashboards[index] = dashboard;
    else dashboards.push(dashboard);
    writeDashboards(dashboards);
    return dashboard;
}

export function createDashboard(
    name?: string,
    description?: string
): Dashboard {
    const now = Date.now();
    const dashboard: Dashboard = {
        id: `db_${randomUUID()}`,
        name: (name || DEFAULT_DASHBOARD_NAME).trim() || DEFAULT_DASHBOARD_NAME,
        description: description?.trim() || undefined,
        items: [],
        autoRefresh: { enabled: false, intervalSeconds: 300 },
        filters: [],
        schemaVersion: DASHBOARDS_SCHEMA_VERSION,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };
    saveDashboard(dashboard);
    return dashboard;
}

export function ensureDashboard(
    input: { dashboardId?: string; dashboardName?: string }
): Dashboard {
    if (input.dashboardId) {
        const existing = getDashboard(input.dashboardId);
        if (!existing) throw new Error('目标仪表盘不存在或已被删除。');
        return existing;
    }
    const name = input.dashboardName?.trim();
    if (name) {
        const existing = readDashboards().find(
            (dashboard) => dashboard.name.toLowerCase() === name.toLowerCase()
        );
        if (existing) return existing;
        return createDashboard(name);
    }
    const dashboards = listDashboards();
    return dashboards[0] || createDashboard();
}

export function updateDashboard(
    dashboardId: string,
    patch: Partial<Pick<Dashboard, 'name' | 'description' | 'autoRefresh' | 'filters'>>
): Dashboard | null {
    const dashboards = readDashboards();
    const index = dashboards.findIndex((dashboard) => dashboard.id === dashboardId);
    if (index < 0) return null;
    const dashboard = dashboards[index];
    const nextName =
        typeof patch.name === 'string' && patch.name.trim()
            ? patch.name.trim()
            : dashboard.name;
    dashboards[index] = {
        ...dashboard,
        ...patch,
        name: nextName,
        updatedAt: Date.now(),
        version: dashboard.version + 1,
    };
    writeDashboards(dashboards);
    return dashboards[index];
}

export function deleteDashboard(dashboardId: string): boolean {
    const dashboards = readDashboards();
    const filtered = dashboards.filter((dashboard) => dashboard.id !== dashboardId);
    if (filtered.length === dashboards.length) return false;
    writeDashboards(filtered);
    return true;
}

export function addChartToDashboard(
    dashboardId: string,
    chartId: string,
    options: { titleOverride?: string; width?: number; height?: number } = {}
): { dashboard: Dashboard; item: DashboardItem; created: boolean } {
    const dashboards = readDashboards();
    const index = dashboards.findIndex((dashboard) => dashboard.id === dashboardId);
    if (index < 0) throw new Error('目标仪表盘不存在或已被删除。');
    if (!getChart(chartId)) throw new Error('图表定义不存在，请重新生成后再订阅。');

    const dashboard = dashboards[index];
    const existing = dashboard.items.find((item) => item.chartId === chartId);
    if (existing) {
        if (options.titleOverride && options.titleOverride !== existing.titleOverride) {
            existing.titleOverride = options.titleOverride;
            dashboards[index] = {
                ...dashboard,
                updatedAt: Date.now(),
                version: dashboard.version + 1,
            };
            writeDashboards(dashboards);
        }
        return { dashboard: dashboards[index], item: existing, created: false };
    }

    const width = clamp(options.width ?? DEFAULT_ITEM_WIDTH, 3, 12);
    const height = clamp(options.height ?? DEFAULT_ITEM_HEIGHT, 2, 40);
    const slot = findFreeSlot(dashboard.items, width, height);
    const item: DashboardItem = {
        id: `dbi_${randomUUID()}`,
        chartId,
        ...slot,
        titleOverride: options.titleOverride?.trim() || undefined,
    };
    const next: Dashboard = {
        ...dashboard,
        items: compactLayout([...dashboard.items, item]),
        updatedAt: Date.now(),
        version: dashboard.version + 1,
    };
    dashboards[index] = next;
    writeDashboards(dashboards);
    return { dashboard: next, item: next.items.find((entry) => entry.id === item.id) || item, created: true };
}

export function removeChartFromDashboard(dashboardId: string, itemId: string): Dashboard | null {
    const dashboards = readDashboards();
    const index = dashboards.findIndex((dashboard) => dashboard.id === dashboardId);
    if (index < 0) return null;
    const dashboard = dashboards[index];
    const items = dashboard.items.filter((item) => item.id !== itemId);
    dashboards[index] = {
        ...dashboard,
        items,
        updatedAt: Date.now(),
        version: dashboard.version + 1,
    };
    writeDashboards(dashboards);
    return dashboards[index];
}

export function updateDashboardLayout(
    dashboardId: string,
    layout: Array<Pick<DashboardItem, 'id' | 'x' | 'y' | 'w' | 'h'>>
): Dashboard | null {
    const dashboards = readDashboards();
    const index = dashboards.findIndex((dashboard) => dashboard.id === dashboardId);
    if (index < 0) return null;
    const dashboard = dashboards[index];
    const byId = new Map(layout.map((entry) => [entry.id, entry]));
    const moved = dashboard.items.map((item) => {
        const patch = byId.get(item.id);
        if (!patch) return item;
        return {
            ...item,
            ...normalizeRect({
                x: patch.x,
                y: patch.y,
                w: patch.w,
                h: patch.h,
            }),
        };
    });
    dashboards[index] = {
        ...dashboard,
        items: compactLayout(moved),
        updatedAt: Date.now(),
        version: dashboard.version + 1,
    };
    writeDashboards(dashboards);
    return dashboards[index];
}

export function dashboardContainingChart(chartId: string): Dashboard | null {
    return readDashboards().find((dashboard) =>
        dashboard.items.some((item) => item.chartId === chartId)
    ) || null;
}
