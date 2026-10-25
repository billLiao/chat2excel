import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDir = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-filters-${process.pid}`
);

vi.mock('electron', () => ({
    app: {
        getPath: () => testDir,
        getAppPath: () => process.cwd(),
        getVersion: () => '0.0.0-test',
    },
}));

vi.mock('electron-store', () => {
    class MemoryStore {
        private data: Record<string, unknown>;
        constructor(options?: { defaults?: Record<string, unknown> }) {
            this.data = JSON.parse(JSON.stringify(options?.defaults || {}));
        }
        get(key: string) {
            return this.data[key];
        }
        set(key: string, value: unknown) {
            this.data[key] = JSON.parse(JSON.stringify(value));
        }
        delete(key: string) {
            delete this.data[key];
        }
    }
    return { default: MemoryStore };
});

vi.mock('../electron/store', () => ({
    store: {
        get: () => undefined,
        set: () => undefined,
        delete: () => undefined,
    },
}));

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();
    const homedir = () => `${testDir}/home`;
    return { ...actual, homedir, default: { ...actual, homedir } };
});

import { db } from '../electron/db';
import { importWorkbook } from '../electron/capabilities/excel';
import { buildChartFromSpec } from '../electron/charts/compiler';
import { pinChart, refreshChart, refreshDashboard } from '../electron/charts/refresh';
import {
    applyFiltersToSql,
    filterCacheKey,
    filterCondition,
    quoteIdentifier,
    sqlLiteral,
    type DescribedColumn,
} from '../electron/charts/filters';
import { getDashboard, listDashboards, updateDashboard } from '../electron/charts/store';
import type { ChartPayload, DashboardFilter } from '../src/lib/charts/types';

const described: DescribedColumn[] = [
    { column_name: 'region', column_type: 'VARCHAR' },
    { column_name: 'total', column_type: 'DOUBLE' },
    { column_name: 'day', column_type: 'DATE' },
];

const baseSql = 'SELECT region, SUM(amount) AS total FROM sales GROUP BY region';

function fakeDescribe(): (sql: string) => Promise<DescribedColumn[]> {
    return async () => described;
}

let tableName = '';
let liveChartId = '';
let snapshotChartId = '';
let dashboardId = '';

beforeAll(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    await db.init();

    fs.writeFileSync(
        path.join(testDir, 'sales.csv'),
        [
            'region,amount',
            '华东,100',
            '华南,200',
            '华北,50',
        ].join('\n'),
        'utf-8'
    );
    const summary = await importWorkbook(path.join(testDir, 'sales.csv'));
    tableName = summary.sheets[0].tableName;
    const sql = `SELECT region, SUM(amount) AS total FROM "${tableName}" GROUP BY region`;
    const artifact = await db.query(sql);

    // Distinct fingerprints: same SQL, different themes, so the snapshot pin
    // creates its own definition instead of reusing the live one.
    const liveChart: ChartPayload = buildChartFromSpec(
        artifact,
        { chartType: 'bar', x: 'region', y: ['total'], theme: 'default' },
        { title: 'Regional sales' }
    );
    const snapChart: ChartPayload = buildChartFromSpec(
        artifact,
        { chartType: 'bar', x: 'region', y: ['total'], theme: 'swiss' },
        { title: 'Regional sales (snapshot)' }
    );

    const pinned = await pinChart({ chart: liveChart, dashboardName: 'Filter board', mode: 'live' });
    liveChartId = pinned.chart.id;
    dashboardId = pinned.dashboard.id;

    const snap = await pinChart({ chart: snapChart, dashboardName: 'Filter board', mode: 'snapshot' });
    snapshotChartId = snap.chart.id;
    expect(snapshotChartId).not.toBe(liveChartId);
});

afterAll(async () => {
    await db.close();
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
});

describe('filter SQL rendering', () => {
    it('quotes identifiers and escapes string literals', () => {
        expect(quoteIdentifier('region')).toBe('"region"');
        expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
        expect(sqlLiteral("o'brien")).toBe(`'o''brien'`);
        expect(sqlLiteral(42)).toBe('42');
        expect(sqlLiteral('42', 'DOUBLE')).toBe('42');
        expect(sqlLiteral('2024-01-01', 'DATE')).toBe(`'2024-01-01'`);
    });

    it('builds date-range conditions with DATE casts only for date columns', () => {
        const dayFilter: DashboardFilter = {
            id: 'f1',
            kind: 'date-range',
            column: 'day',
            from: '2024-01-01',
            to: '2024-01-31',
        };
        expect(filterCondition(dayFilter, described)).toBe(
            `"day" >= CAST('2024-01-01' AS DATE) AND "day" <= CAST('2024-01-31' AS DATE)`
        );

        // Same filter against a non-date column falls back to string literals.
        const varcharFilter: DashboardFilter = {
            id: 'f2',
            kind: 'date-range',
            column: 'region',
            from: '2024-01-01',
        };
        expect(filterCondition(varcharFilter, described)).toBe(`"region" >= '2024-01-01'`);

        // Malformed dates produce no condition at all.
        const broken: DashboardFilter = {
            id: 'f3',
            kind: 'date-range',
            column: 'day',
            from: '2024/01/01',
        };
        expect(filterCondition(broken, described)).toBeNull();
    });

    it('builds category IN conditions and rejects unknown columns', () => {
        const filter: DashboardFilter = {
            id: 'f4',
            kind: 'category',
            column: 'REGION',
            values: ['华东', '华南'],
        };
        expect(filterCondition(filter, described)).toBe(`"region" IN ('华东', '华南')`);

        expect(
            filterCondition(
                { id: 'f5', kind: 'category', column: 'missing', values: ['x'] },
                described
            )
        ).toBeNull();
        expect(
            filterCondition(
                { id: 'f6', kind: 'category', column: 'region', values: [] },
                described
            )
        ).toBeNull();
    });

    it('wraps the base SQL with applicable filters and reports skipped ones', async () => {
        const filters: DashboardFilter[] = [
            { id: 'f7', kind: 'category', column: 'region', values: ['华东'] },
            { id: 'f8', kind: 'category', column: 'missing', values: ['x'] },
        ];
        const result = await applyFiltersToSql(baseSql, filters, fakeDescribe());
        expect(result.applied).toEqual(['region']);
        expect(result.skipped).toEqual(['missing']);
        expect(result.sql).toBe(
            `SELECT * FROM (${baseSql}) AS _filters_base WHERE "region" IN ('华东')`
        );

        const untouched = await applyFiltersToSql(baseSql, [], fakeDescribe());
        expect(untouched).toEqual({ sql: baseSql, applied: [], skipped: [] });
    });

    it('produces a stable, order-insensitive cache key', () => {
        const a: DashboardFilter[] = [
            { id: '1', kind: 'category', column: 'region', values: ['华东', '华南'] },
            { id: '2', kind: 'date-range', column: 'day', from: '2024-01-01' },
        ];
        const b: DashboardFilter[] = [
            { id: 'x', kind: 'date-range', column: 'day', from: '2024-01-01' },
            { id: 'y', kind: 'category', column: 'region', values: ['华南', '华东'] },
        ];
        expect(filterCacheKey(a)).toBe(filterCacheKey(b));
        expect(filterCacheKey([])).toBe('');
        expect(filterCacheKey()).toBe('');
        expect(filterCacheKey(a)).not.toBe(filterCacheKey([{ ...a[0], from: undefined }]));
    });
});

describe('dashboard-filter refresh integration', () => {
    it('filters live chart rows and tags the payload with chartId', async () => {
        const filters: DashboardFilter[] = [
            { id: 'f9', kind: 'category', column: 'region', values: ['华东'] },
        ];
        const result = await refreshChart(liveChartId, { force: true, filters });
        expect(result.success).toBe(true);
        expect(result.chart?.rows.map((row) => row.region)).toEqual(['华东']);
        expect(result.chart?.chartId).toBe(liveChartId);

        // The unfiltered definition state is untouched by a filtered refresh.
        const unfiltered = await refreshChart(liveChartId, { force: true });
        expect(unfiltered.success).toBe(true);
        expect(unfiltered.chart?.rows).toHaveLength(3);
        expect(unfiltered.chart?.chartId).toBeUndefined();
    });

    it('ignores filters for snapshot charts', async () => {
        const filters: DashboardFilter[] = [
            { id: 'f10', kind: 'category', column: 'region', values: ['华东'] },
        ];
        const result = await refreshChart(snapshotChartId, { force: false, filters });
        expect(result.success).toBe(true);
        expect(result.chart?.rows).toHaveLength(3);
    });

    it('refreshes a dashboard through its persisted filters', async () => {
        const filters: DashboardFilter[] = [
            { id: 'f11', kind: 'category', column: 'region', values: ['华东'] },
        ];
        const updated = updateDashboard(dashboardId, { filters });
        expect(updated?.filters).toEqual(filters);

        const dashboard = getDashboard(dashboardId)!;
        expect(dashboard.schemaVersion).toBe(1);

        // refreshDashboard picks up the stored filters; the live chart is
        // filtered while the snapshot stays frozen.
        const result = await refreshDashboard(dashboardId, { force: true });
        const liveItem = result.items.find((item) => item.chartId === liveChartId)!;
        const snapItem = result.items.find((item) => item.chartId === snapshotChartId)!;
        expect(liveItem.success).toBe(true);
        expect(liveItem.chart?.rows.map((row) => row.region)).toEqual(['华东']);
        expect(snapItem.success).toBe(true);
        expect(snapItem.chart?.rows).toHaveLength(3);

        const dashboards = listDashboards();
        expect(dashboards[0].schemaVersion).toBe(1);
    });
});
