import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/lib/agent/message';
import type { ChartPayload } from '../src/lib/charts/types';
import { slimMessageForPersist } from '../electron/agent/slim';

function bigChartMessage(): ChatMessage {
    const chart: ChartPayload = {
        chartType: 'bar',
        title: 'Sales',
        columns: [{ name: 'region', type: 'VARCHAR' }],
        rows: [
            { region: '华东', total: 1 },
            { region: '华南', total: 2 },
        ],
        encoding: { x: 'region', y: ['total'] },
        option: { series: [] },
        warnings: [],
        spec: { chartType: 'bar', x: 'region', y: ['total'] },
        sql: 'SELECT 1',
    };
    return {
        id: 'm1',
        role: 'assistant',
        content: 'chart',
        timestamp: 1,
        chart,
    };
}

describe('slimMessageForPersist', () => {
    it('drops chart rows and compiled options', () => {
        const message = bigChartMessage();
        const slim = slimMessageForPersist(message);
        expect(slim.chart?.rows).toEqual([]);
        expect(slim.chart?.option).toEqual({});
        // Metadata survives so hydration and the chat table can still work.
        expect(slim.chart?.sql).toBe('SELECT 1');
        expect(slim.chart?.columns).toHaveLength(1);
        expect(slim.chart?.encoding).toMatchObject({ x: 'region' });
    });

    it('caps query preview rows at 12', () => {
        const rows = Array.from({ length: 40 }, (_, index) => ({ id: index }));
        const slim = slimMessageForPersist({
            id: 'm2',
            role: 'assistant',
            content: 'query',
            timestamp: 2,
            query: {
                queryId: 'q1',
                sql: 'SELECT 1',
                columns: [{ name: 'id', type: 'INTEGER' }],
                rows,
                rowCount: 40,
                returnedRows: 40,
                truncated: false,
                elapsedMs: 1,
            },
        });
        expect(slim.query?.rows).toHaveLength(12);
        expect(slim.query?.rowCount).toBe(40);
    });

    it('leaves messages without artifacts untouched (same reference)', () => {
        const message: ChatMessage = {
            id: 'm3',
            role: 'user',
            content: 'hello',
            timestamp: 3,
        };
        expect(slimMessageForPersist(message)).toBe(message);
    });

    it('does not mutate the original message', () => {
        const message = bigChartMessage();
        slimMessageForPersist(message);
        expect(message.chart?.rows).toHaveLength(2);
    });
});
