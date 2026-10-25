import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDir = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-tools-db-${process.pid}`
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

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { db } from '../electron/db';
import { importWorkbook } from '../electron/capabilities/excel';
import { createDefaultAgentTools } from '../electron/agent/tools';
import { getChart } from '../electron/charts/store';

let tableName = '';
let tools: AgentTool<any, any>[] = [];

function tool(name: string): AgentTool<any, any> {
    const found = tools.find((item) => item.name === name);
    if (!found) throw new Error(`Missing tool ${name}`);
    return found;
}

beforeAll(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    await db.init();

    const csvPath = path.join(testDir, 'sales.csv');
    fs.writeFileSync(
        csvPath,
        [
            'region,amount,ordered_at',
            '华东,100.5,2024-01-01',
            '华东,49.5,2024-01-02',
            '华南,200,2024-01-03',
        ].join('\n'),
        'utf-8'
    );
    const summary = await importWorkbook(csvPath);
    tableName = summary.sheets[0].tableName;
    tools = await createDefaultAgentTools({
        contextTables: [tableName],
        queryIds: new Set<string>(),
        sessionId: 'test-session',
    });
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

describe('default tools over a real DuckDB file', () => {
    it('lists and profiles tables before querying', async () => {
        const listed = await tool('list_tables').execute('c1', {});
        const listText = listed.content[0].text as string;
        expect(listText).toContain(tableName);
        expect(listText).toContain('3 rows');

        const described = await tool('describe_table').execute('c2', {
            tableName,
            sampleRows: 2,
        });
        const profileText = described.content[0].text as string;
        expect(profileText).toContain('amount (DOUBLE');
        expect(profileText).toContain('region (VARCHAR');
        expect(profileText).toContain('Sample rows');
        expect(profileText).toContain('华东');
        expect(profileText).toContain('Rows: 3');
    });

    it('queries, charts, pages and exports the same artifact', async () => {
        const queried = await tool('query_database').execute('c3', {
            sql: `SELECT region, SUM(amount) AS total FROM "${tableName}" GROUP BY region ORDER BY total DESC`,
        });
        const query = queried.details.query;
        expect(query.rows).toEqual([
            { region: '华南', total: 200 },
            { region: '华东', total: 150 },
        ]);

        const charted = await tool('create_chart').execute('c4', {
            queryId: query.queryId,
            chartType: 'bar',
            x: 'region',
            y: 'total',
        });
        expect(charted.details.chart.chartType).toBe('bar');
        expect(charted.details.chart.rows).toHaveLength(2);

        const page = await tool('read_query_page').execute('c5', {
            queryId: query.queryId,
            offset: 1,
            limit: 1,
        });
        expect(page.details.page.rows).toEqual([{ region: '华东', total: 150 }]);

        const exported = await tool('export_query').execute('c6', {
            queryId: query.queryId,
            filename: 'region-sales',
            format: 'xlsx',
        });
        const result = exported.details.export;
        expect(result.format).toBe('xlsx');
        expect(result.fileName).toBe('region-sales.xlsx');
        expect(fs.existsSync(result.filePath)).toBe(true);
        expect(result.filePath).toContain(path.join('exports', 'region-sales.xlsx'));
    });

    it('creates an advanced chart and subscribes it to a dashboard', async () => {
        const queried = await tool('query_database').execute('c8', {
            sql: `SELECT ordered_at, SUM(amount) AS total FROM "${tableName}" GROUP BY ordered_at ORDER BY ordered_at`,
        });
        const queryId = queried.details.query.queryId;

        const created = await tool('create_chart').execute('c9', {
            queryId,
            chartType: 'line',
            x: 'ordered_at',
            y: 'total',
            title: 'Daily sales',
            valueFormat: 'currency',
            saveToDashboard: true,
            dashboardName: '工具测试看板',
        });

        const chart = created.details.chart;
        expect(chart.chartType).toBe('line');
        expect(chart.sql).toContain('SELECT ordered_at');
        expect(chart.datasetIds).toHaveLength(1);
        expect(created.details.pinned).toMatchObject({
            dashboardName: '工具测试看板',
            mode: 'live',
        });

        const definition = getChart(created.details.pinned.chartId);
        expect(definition?.provenance?.sessionId).toBe('test-session');
        expect(definition?.provenance?.toolCallId).toBe('c9');
        expect(definition?.query.sql).toBe(chart.sql);
    });

    it('keeps the context table allow-list', async () => {
        await expect(
            tool('query_database').execute('c7', {
                sql: 'SELECT * FROM "some_other_table"',
            })
        ).rejects.toThrow(/not available|not allowed|unknown|not found/i);
    });
});
