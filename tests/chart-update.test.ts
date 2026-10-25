import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDir = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-update-${process.pid}`
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
import {
    pinChart,
    rebuildChartPayload,
    updateChartSpec,
} from '../electron/charts/refresh';
import { getChart } from '../electron/charts/store';
import type { ChartPayload } from '../src/lib/charts/types';

let chartId = '';

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
    const tableName = summary.sheets[0].tableName;
    const sql = `SELECT region, SUM(amount) AS total FROM "${tableName}" GROUP BY region`;
    const artifact = await db.query(sql);
    const chart: ChartPayload = buildChartFromSpec(
        artifact,
        { chartType: 'bar', x: 'region', y: ['total'], sort: { by: 'total', order: 'desc' } },
        { title: 'Regional sales' }
    );
    const pinned = await pinChart({ chart, dashboardName: 'Editor board' });
    chartId = pinned.chart.id;
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

describe('updateChartSpec (no-model chart authoring)', () => {
    it('re-encodes a chart into a table without changing the SQL', async () => {
        const result = await updateChartSpec({
            chartId,
            spec: { chartType: 'table', y: ['total'], aggregate: 'none' },
        });
        expect(result.definition.spec.chartType).toBe('table');
        expect(result.definition.query.sql).toContain('GROUP BY region');
        expect(result.chart.chartType).toBe('table');
        expect(result.chart.chartId).toBe(chartId);

        const saved = getChart(chartId)!;
        expect(saved.spec.chartType).toBe('table');
        expect(saved.query.sqlHash).toBeTruthy();
    });

    it('renames the chart and back to a bar', async () => {
        const result = await updateChartSpec({
            chartId,
            title: '区域销售汇总',
            spec: { chartType: 'bar', x: 'region', y: ['total'], aggregate: 'sum' },
        });
        expect(result.definition.title).toBe('区域销售汇总');
        expect(result.definition.spec.chartType).toBe('bar');
        expect(result.definition.spec.aggregate).toBe('sum');
    });

    it('rejects an invalid encoding without persisting anything', async () => {
        await expect(
            updateChartSpec({ chartId, spec: { chartType: 'pie', x: 'region', y: [] } })
        ).rejects.toThrow();
        const saved = getChart(chartId)!;
        expect(saved.spec.chartType).toBe('bar');
    });

    it('repairs a broken SQL and recomputes the stored hash', async () => {
        const savedBefore = getChart(chartId)!;
        const result = await updateChartSpec({
            chartId,
            sql: `SELECT region, COUNT(*) AS total FROM "${savedBefore.query.tables[0]}" GROUP BY region`,
        });
        expect(result.definition.query.sql).toContain('COUNT(*)');
        expect(result.definition.query.sqlHash).not.toBe(savedBefore.query.sqlHash);
        expect(result.definition.fingerprint).not.toBe(savedBefore.fingerprint);
        expect(result.definition.datasetIds.length).toBeGreaterThan(0);
    });
});

describe('rebuildChartPayload (hydration)', () => {
    it('rebuilds from a saved definition by chartId', async () => {
        const chart = await rebuildChartPayload({ chartId });
        expect(chart.chartId).toBe(chartId);
        expect(chart.rows.length).toBe(3);
        expect(chart.chartType).toBe('bar');
    });

    it('rebuilds ad-hoc charts from sql + spec metadata', async () => {
        const saved = getChart(chartId)!;
        const chart = await rebuildChartPayload({
            sql: saved.query.sql,
            spec: { chartType: 'bar', x: 'region', y: ['total'] },
            title: 'Ad hoc',
        });
        expect(chart.chartId).toBeUndefined();
        expect(chart.rows.length).toBe(3);
        expect(chart.title).toBe('Ad hoc');
    });

    it('throws when nothing usable is provided', async () => {
        await expect(rebuildChartPayload({})).rejects.toThrow(/缺少查询元数据|SQL/);
        await expect(
            rebuildChartPayload({ chartId: 'chart_missing' })
        ).rejects.toThrow();
    });
});
