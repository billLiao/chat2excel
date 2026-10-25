import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDir = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-dashboard-${process.pid}`
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
import { pinChart, refreshChart } from '../electron/charts/refresh';
import {
    deleteChart,
    getDashboard,
    listCharts,
    listDashboards,
} from '../electron/charts/store';
import type { ChartPayload } from '../src/lib/charts/types';

let tableName = '';
let sql = '';
let liveChartId = '';
let snapshotChartId = '';
let dashboardId = '';
let liveChart: ChartPayload;

function writeSales(huadong: number, huanan: number): void {
    fs.writeFileSync(
        path.join(testDir, 'sales.csv'),
        [
            'region,amount',
            `华东,${huadong}`,
            `华南,${huanan}`,
            '华北,50',
        ].join('\n'),
        'utf-8'
    );
}

async function buildChart(theme?: 'default' | 'swiss'): Promise<ChartPayload> {
    const artifact = await db.query(sql);
    return buildChartFromSpec(
        artifact,
        {
            chartType: 'bar',
            x: 'region',
            y: ['total'],
            sort: { by: 'total', order: 'desc' },
            theme,
        },
        { title: 'Regional sales' }
    );
}

beforeAll(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    await db.init();
    writeSales(100, 200);

    const summary = await importWorkbook(path.join(testDir, 'sales.csv'));
    tableName = summary.sheets[0].tableName;
    sql = `SELECT region, SUM(amount) AS total FROM "${tableName}" GROUP BY region`;

    liveChart = await buildChart('default');
    const pinned = await pinChart({
        chart: liveChart,
        dashboardName: 'Sales board',
        mode: 'live',
        provenance: { sessionId: 's1', toolCallId: 'c1' },
    });
    liveChartId = pinned.chart.id;
    dashboardId = pinned.dashboard.id;

    const snapshot = await pinChart({
        chart: await buildChart('swiss'),
        dashboardName: 'Sales board',
        mode: 'snapshot',
    });
    snapshotChartId = snapshot.chart.id;
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

describe('chart definitions and dashboards', () => {
    it('persists metadata, not rendered options', async () => {
        const charts = listCharts();
        expect(charts).toHaveLength(2);
        const saved = charts.find((chart) => chart.id === liveChartId)!;
        expect(saved.query.sql).toBe(sql);
        expect(saved.query.tables).toContain(tableName);
        expect(saved.datasetIds.length).toBe(1);
        expect(saved.refresh.mode).toBe('live');
        expect(saved.provenance?.sessionId).toBe('s1');
        expect(saved as any).not.toHaveProperty('option');
        expect(saved as any).not.toHaveProperty('rows');

        const dashboards = listDashboards();
        expect(dashboards).toHaveLength(1);
        expect(dashboards[0].items).toHaveLength(2);
        expect(dashboards[0].items.map((item) => item.chartId).sort()).toEqual(
            [liveChartId, snapshotChartId].sort()
        );
    });

    it('replays saved SQL on refresh and follows reimported data', async () => {
        const first = await refreshChart(liveChartId, { force: true });
        expect(first.success).toBe(true);
        const totals = Object.fromEntries(
            (first.chart?.rows || []).map((row) => [row.region, row.total])
        );
        expect(totals).toMatchObject({ 华东: 100, 华南: 200, 华北: 50 });

        // Reimport the same file name; identity and physical table must survive.
        writeSales(350, 200);
        const summary = await importWorkbook(path.join(testDir, 'sales.csv'));
        expect(summary.sheets[0].tableName).toBe(tableName);
        expect(summary.sheets[0].importVersion).toBe(2);
        expect(summary.sheets[0].datasetUpdated).toBe(true);

        const refreshed = await refreshChart(liveChartId, { force: true });
        expect(refreshed.success).toBe(true);
        const next = Object.fromEntries(
            (refreshed.chart?.rows || []).map((row) => [row.region, row.total])
        );
        expect(next.华东).toBe(350);
        expect(refreshed.definition?.lastRefresh?.status).toBe('ok');
    });

    it('keeps snapshot charts frozen until forced', async () => {
        const cached = await refreshChart(snapshotChartId, { force: false });
        expect(cached.success).toBe(true);
        expect(cached.cached).toBe(true);
        const frozen = Object.fromEntries(
            (cached.chart?.rows || []).map((row) => [row.region, row.total])
        );
        expect(frozen.华东).toBe(100);

        const forced = await refreshChart(snapshotChartId, { force: true });
        expect(forced.success).toBe(true);
        const updated = Object.fromEntries(
            (forced.chart?.rows || []).map((row) => [row.region, row.total])
        );
        expect(updated.华东).toBe(350);
    });

    it('removes a deleted chart from dashboards', async () => {
        expect(deleteChart(snapshotChartId)).toBe(true);
        const dashboard = getDashboard(dashboardId)!;
        expect(dashboard.items.map((item) => item.chartId)).not.toContain(snapshotChartId);
        expect(dashboard.items).toHaveLength(1);
    });
});
