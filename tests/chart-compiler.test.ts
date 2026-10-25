import { describe, expect, it } from 'vitest';
import {
    ChartBuildError,
    buildChartFromRows,
    chartFingerprint,
    normalizeChartSpec,
    stableSqlHash,
} from '../electron/charts/compiler';
import { CHART_TYPES, type ChartColumn } from '../src/lib/charts/types';

const columns: ChartColumn[] = [
    { name: 'region', type: 'VARCHAR' },
    { name: 'month', type: 'DATE' },
    { name: 'channel', type: 'VARCHAR' },
    { name: 'amount', type: 'DOUBLE' },
    { name: 'orders', type: 'BIGINT' },
];

const rows = [
    { region: '华东', month: '2024-01-01', channel: '线上', amount: 100, orders: 4 },
    { region: '华东', month: '2024-02-01', channel: '线下', amount: 60, orders: 2 },
    { region: '华南', month: '2024-01-01', channel: '线上', amount: 200, orders: 7 },
    { region: '华南', month: '2024-02-01', channel: '线上', amount: 40, orders: 1 },
];

function build(spec: Parameters<typeof buildChartFromRows>[2]) {
    return buildChartFromRows(columns, rows, spec);
}

describe('declarative chart compiler', () => {
    it('builds bar, line and area charts from the same rows', () => {
        for (const chartType of ['bar', 'hbar', 'line', 'area', 'stackedBar', 'stackedArea'] as const) {
            const chart = build({ chartType, x: 'region', y: ['amount'] });
            expect(chart.chartType).toBe(chartType);
            expect(chart.rows).toHaveLength(4);
            expect(chart.encoding).toMatchObject({ x: 'region', y: ['amount'] });
            expect(Array.isArray((chart.option as any).series)).toBe(true);
            expect(chart.option).not.toHaveProperty('source');
        }
    });

    it('aggregates duplicate categories and supports sorting and limits', () => {
        const chart = build({
            chartType: 'bar',
            x: 'region',
            y: ['amount'],
            aggregate: 'sum',
            sort: { by: 'amount', order: 'desc' },
        });
        const option = chart.option as any;
        expect(option.xAxis.data).toEqual(['华南', '华东']);
        const values = option.series[0].data;
        expect(values).toEqual([240, 160]);
        expect(chart.warnings.join(' ')).toMatch(/Duplicate x values/i);

        const limited = build({
            chartType: 'hbar',
            x: 'region',
            y: ['amount'],
            sort: { by: 'amount', order: 'desc' },
            limit: 1,
        });
        expect((limited.option as any).yAxis.data).toEqual(['华南']);
    });

    it('turns stacked series into a percentBar that sums to 100', () => {
        const chart = build({
            chartType: 'percentBar',
            x: 'month',
            y: ['amount'],
            series: 'channel',
        });
        const option = chart.option as any;
        const totals = option.series[0].data.map((_: number, index: number) =>
            option.series.reduce((sum: number, entry: any) => sum + entry.data[index], 0)
        );
        for (const total of totals) expect(total).toBeCloseTo(100, 6);
    });

    it('renders pie, donut, scatter, bubble, combo and heatmap without ECharts JSON input', () => {
        const pie = build({ chartType: 'donut', x: 'region', y: ['amount'] });
        expect((pie.option as any).series[0].type).toBe('pie');
        expect((pie.option as any).series[0].radius).toBeTruthy();

        const scatter = build({ chartType: 'scatter', x: 'orders', y: ['amount'] });
        expect((scatter.option as any).series[0].type).toBe('scatter');

        const bubble = build({ chartType: 'bubble', x: 'orders', y: ['amount'], size: 'orders' });
        expect((bubble.option as any).series[0].type).toBe('scatter');
        expect((bubble.option as any).series[0].symbolSize).toBeTypeOf('function');

        const combo = build({
            chartType: 'combo',
            x: 'month',
            y: ['amount'],
            y2: ['orders'],
        });
        expect((combo.option as any).yAxis).toHaveLength(2);
        expect((combo.option as any).series.map((entry: any) => entry.type)).toEqual([
            'bar',
            'line',
        ]);

        const heatmap = build({
            chartType: 'heatmap',
            x: 'month',
            y: ['amount'],
            series: 'channel',
        });
        const heatSeries = (heatmap.option as any).series[0];
        expect(heatSeries.type).toBe('heatmap');
        expect(Array.isArray(heatSeries.data)).toBe(true);
        expect((heatmap.option as any).visualMap).toBeTruthy();
    });

    it('renders KPI and table payloads without an ECharts option', () => {
        const kpi = build({ chartType: 'kpi', y: ['amount'] });
        expect(kpi.kpis?.length).toBe(1);
        expect(kpi.kpis?.[0].value).toBe(400);
        expect(kpi.option).toEqual({});

        const table = build({ chartType: 'table' });
        expect(table.option).toEqual({});
        expect(table.rows).toHaveLength(4);
        expect(table.columns).toHaveLength(5);
    });

    it('applies themes and reports invalid encodings', () => {
        const chart = build({ chartType: 'bar', x: 'region', y: ['amount'], theme: 'economist' });
        expect(chart.theme).toBe('economist');
        const firstColor = (chart.option as any).series[0].itemStyle.color;
        expect(typeof firstColor).toBe('string');
        expect(firstColor).not.toBe('#2563eb');

        expect(() => build({ chartType: 'bar', x: 'missing', y: ['amount'] })).toThrow(
            ChartBuildError
        );
        expect(() => build({ chartType: 'bar', x: 'region', y: ['region'] })).toThrow(
            /not numeric/i
        );
        expect(() => build({ chartType: 'heatmap', x: 'month', y: ['amount'] })).toThrow(
            /series column/i
        );
    });

    it('keeps a stable fingerprint for the same query and encoding', () => {
        const sql = 'SELECT region, SUM(amount) AS total FROM ds_sales GROUP BY region';
        expect(stableSqlHash(sql)).toBe(stableSqlHash(sql));
        expect(stableSqlHash(sql)).not.toBe(stableSqlHash(sql.replace('SUM', 'AVG')));

        const spec = normalizeChartSpec(
            { chartType: 'bar', x: 'region', y: ['amount'] },
            columns
        );
        expect(chartFingerprint(sql, spec)).toBe(chartFingerprint(sql, { ...spec }));
        expect(chartFingerprint(sql, spec)).not.toBe(
            chartFingerprint(sql, { ...spec, chartType: 'line' })
        );
    });

    it('declares every supported chart type', () => {
        expect(CHART_TYPES).toHaveLength(15);
    });
});
