import { describe, expect, it } from 'vitest';
import { buildChart, ChartBuildError } from '../electron/agent/chart';
import type { QueryArtifact } from '../electron/agent/result-store';

function artifact(rows: unknown[][]): QueryArtifact {
    return {
        id: 'q_test',
        sql: 'SELECT ...',
        tables: ['sales'],
        columns: [
            { name: 'region', type: 'VARCHAR' },
            { name: 'amount', type: 'DOUBLE' },
        ],
        rows,
        rowCount: rows.length,
        truncated: false,
        elapsedMs: 1,
        createdAt: Date.now(),
    };
}

describe('chart builder', () => {
    it('builds a bar chart from real rows', () => {
        const chart = buildChart(artifact([
            ['华东', 100],
            ['华南', 60],
        ]), {
            queryId: 'q_test',
            chartType: 'bar',
            x: 'region',
            y: 'amount',
        });

        expect(chart.queryId).toBe('q_test');
        expect(chart.rows).toHaveLength(2);
        const option = chart.option as any;
        expect(option.xAxis.data).toEqual(['华东', '华南']);
        expect(option.series[0].data).toEqual([100, 60]);
    });

    it('sums duplicate x values and warns', () => {
        const chart = buildChart(artifact([
            ['华东', 100],
            ['华东', 50],
        ]), {
            queryId: 'q_test',
            chartType: 'bar',
            x: 'region',
            y: 'amount',
        });

        const option = chart.option as any;
        expect(option.xAxis.data).toEqual(['华东']);
        expect(option.series[0].data).toEqual([150]);
        expect(chart.warnings.length).toBeGreaterThan(0);
    });

    it('builds a pie chart and rejects non-numeric y columns', () => {
        const chart = buildChart(artifact([
            ['华东', 100],
            ['华南', 300],
        ]), {
            queryId: 'q_test',
            chartType: 'pie',
            x: 'region',
            y: 'amount',
        });
        const option = chart.option as any;
        expect(option.series[0].data).toEqual([
            { name: '华东', value: 100 },
            { name: '华南', value: 300 },
        ]);

        expect(() =>
            buildChart(artifact([
                ['华东', 'n/a'],
                ['华南', 'oops'],
            ]), {
                queryId: 'q_test',
                chartType: 'bar',
                x: 'region',
                y: 'amount',
            })
        ).toThrow(ChartBuildError);
    });

    it('rejects columns that are not in the artifact', () => {
        expect(() =>
            buildChart(artifact([['华东', 1]]), {
                queryId: 'q_test',
                chartType: 'bar',
                x: 'province',
                y: 'amount',
            })
        ).toThrow(ChartBuildError);
    });
});
