import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testRoot = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-tools-test-${process.pid}`
);

vi.mock('electron', () => ({
    app: {
        getPath: () => `${testRoot}/userData`,
        getAppPath: () => process.cwd(),
        getVersion: () => '0.0.0-test',
    },
}));

vi.mock('../electron/store', () => ({
    store: {
        get: () => undefined,
        set: () => undefined,
        delete: () => undefined,
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

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();
    const homedir = () => `${testRoot}/home`;
    return { ...actual, homedir, default: { ...actual, homedir } };
});

let createDefaultAgentTools: typeof import('../electron/agent/tools').createDefaultAgentTools;

beforeAll(async () => {
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    ({ createDefaultAgentTools } = await import('../electron/agent/tools'));
});

afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('default agent tools', () => {
    it('registers the product capabilities in a stable order', async () => {
        const tools = await createDefaultAgentTools({ queryIds: new Set() });
        expect(tools.map((tool) => tool.name)).toEqual([
            'list_tables',
            'describe_table',
            'query_database',
            'read_query_page',
            'create_chart',
            'export_query',
            'read_skill',
            'ask_user',
        ]);

        for (const tool of tools) {
            expect(tool.description.length).toBeGreaterThan(20);
            expect(tool.parameters).toBeTruthy();
        }
    });

    it('rejects exports and charting for query ids outside the conversation', async () => {
        const tools = await createDefaultAgentTools({ queryIds: new Set() });
        const exportTool = tools.find((tool) => tool.name === 'export_query')!;
        const chartTool = tools.find((tool) => tool.name === 'create_chart')!;

        await expect(
            exportTool.execute('call-1', { queryId: 'q_missing' })
        ).rejects.toThrow(/does not belong/i);
        await expect(
            chartTool.execute('call-2', {
                queryId: 'q_missing',
                chartType: 'bar',
                x: 'region',
                y: 'amount',
            })
        ).rejects.toThrow(/does not belong/i);
    });
});
