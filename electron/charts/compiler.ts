/**
 * Declarative chart compiler.
 *
 * A chart is described by a small encoding spec (type, dimensions, measures,
 * aggregation, formatting). The compiler turns the *actual* query rows into an
 * ECharts option. Neither the model nor a persisted dashboard ever stores hand
 * written ECharts JSON.
 */

import type {
    ChartAggregate,
    ChartColumn,
    ChartEncoding,
    ChartKpi,
    ChartPayload,
    ChartSpec,
    ChartThemeName,
    ChartType,
    ChartValueFormat,
} from '../../src/lib/charts/types';
import { CHART_TYPES, CHART_THEMES } from '../../src/lib/charts/types';
import { rowsToObjects, type QueryArtifact } from '../agent/result-store';

export class ChartBuildError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChartBuildError';
    }
}

export interface BuildChartOptions {
    queryId?: string;
    title?: string;
    explanation?: string;
    sql?: string;
    tables?: string[];
    datasetIds?: string[];
    /** Explicit theme wins over spec.theme. */
    theme?: ChartThemeName;
}

const PALETTES: Record<ChartThemeName, string[]> = {
    default: [
        '#2563eb',
        '#16a34a',
        '#f59e0b',
        '#dc2626',
        '#7c3aed',
        '#0891b2',
        '#db2777',
        '#65a30d',
        '#ea580c',
        '#475569',
    ],
    economist: ['#0d5c63', '#b23a48', '#e09f3e', '#33658a', '#7a9e7e', '#9b5de5', '#c44536'],
    swiss: ['#e63946', '#1d1d1f', '#457b9d', '#f4a261', '#2a9d8f', '#6d597a', '#8d99ae'],
    ocean: ['#0f766e', '#0284c7', '#0891b2', '#14b8a6', '#2563eb', '#06b6d4', '#6366f1'],
    sunset: ['#ea580c', '#dc2626', '#db2777', '#f59e0b', '#e11d48', '#9333ea', '#f97316'],
    forest: ['#15803d', '#4d7c0f', '#0f766e', '#65a30d', '#166534', '#84cc16', '#0d9488'],
    slate: ['#334155', '#64748b', '#0f172a', '#94a3b8', '#475569', '#1e293b', '#cbd5e1'],
};

const NUMERIC_TYPES = new Set<ChartType>([
    'bar',
    'hbar',
    'stackedBar',
    'percentBar',
    'line',
    'area',
    'stackedArea',
    'pie',
    'donut',
    'scatter',
    'bubble',
    'heatmap',
    'combo',
    'kpi',
]);

export function isChartType(value: unknown): value is ChartType {
    return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value);
}

export function isChartTheme(value: unknown): value is ChartThemeName {
    return typeof value === 'string' && (CHART_THEMES as readonly string[]).includes(value);
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const text = value.replace(/[,%\s]/g, '').trim();
        if (!text) return null;
        const number = Number(text);
        return Number.isFinite(number) ? number : null;
    }
    return null;
}

function label(value: unknown): string {
    if (value === null || value === undefined) return '(空)';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
}

function uniqueColumns(columns: ChartColumn[]): Map<string, ChartColumn> {
    return new Map(columns.map((column) => [column.name, column]));
}

function requireColumn(
    columns: Map<string, ChartColumn>,
    name: string | undefined,
    role: string
): string {
    if (!name) {
        throw new ChartBuildError(`A ${role} column is required for this chart type.`);
    }
    if (!columns.has(name)) {
        const available = Array.from(columns.keys()).join(', ');
        throw new ChartBuildError(
            `The ${role} column "${name}" is not in the query result. Available columns: ${available}.`
        );
    }
    return name;
}

function ensureNumeric(name: string, rows: Record<string, unknown>[]): void {
    const values = rows
        .map((row) => row[name])
        .filter((value) => value !== null && value !== undefined);
    if (values.length === 0) {
        throw new ChartBuildError(`The measure "${name}" is empty.`);
    }
    const numeric = values.filter((value) => asNumber(value) !== null).length;
    if (numeric / values.length < 0.5) {
        throw new ChartBuildError(
            `The measure "${name}" is not numeric (${numeric}/${values.length} values parsed). ` +
                'Cast it in SQL or choose a numeric column.'
        );
    }
}

function isTemporalType(type: string | undefined): boolean {
    return !!type && /DATE|TIME/i.test(type);
}

function themePalette(theme: ChartThemeName): string[] {
    return PALETTES[theme] || PALETTES.default;
}

function defaultAggregate(type: ChartType): ChartAggregate {
    if (type === 'scatter' || type === 'bubble' || type === 'table') return 'none';
    return 'sum';
}

export function normalizeChartSpec(
    input: Partial<ChartSpec> | undefined,
    columns: ChartColumn[],
    fallbackType: ChartType = 'bar'
): ChartSpec {
    const chartType = isChartType(input?.chartType) ? input.chartType : fallbackType;
    const columnMap = uniqueColumns(columns);
    const rawY = Array.isArray(input?.y)
        ? input!.y.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : typeof input?.y === 'string' && input.y
          ? [input.y]
          : [];
    const y = rawY.filter((name) => columnMap.has(name));
    const x = typeof input?.x === 'string' && columnMap.has(input.x) ? input.x : undefined;
    const series =
        typeof input?.series === 'string' && columnMap.has(input.series)
            ? input.series
            : undefined;
    const size =
        typeof input?.size === 'string' && columnMap.has(input.size) ? input.size : undefined;
    const y2 = Array.isArray(input?.y2)
        ? input.y2.filter((name): name is string => typeof name === 'string' && columnMap.has(name))
        : [];

    return {
        chartType,
        x,
        y,
        series,
        size,
        y2,
        aggregate: input?.aggregate || defaultAggregate(chartType),
        sort: input?.sort,
        limit:
            typeof input?.limit === 'number' && Number.isFinite(input.limit)
                ? Math.max(1, Math.min(10_000, Math.floor(input.limit)))
                : undefined,
        theme: isChartTheme(input?.theme) ? input.theme : 'default',
        smooth: input?.smooth,
        showLabels: input?.showLabels,
        stacked: input?.stacked,
        horizontal: input?.horizontal || chartType === 'hbar',
        valueFormat: input?.valueFormat,
        title: input?.title,
        subtitle: input?.subtitle,
        explanation: input?.explanation,
    };
}

function validateSpec(spec: ChartSpec, rows: Record<string, unknown>[], columns: ChartColumn[]): void {
    const columnMap = uniqueColumns(columns);
    if (spec.chartType === 'table') return;

    if (spec.chartType === 'kpi') {
        if (spec.y.length === 0) {
            throw new ChartBuildError('A KPI needs at least one measure column (y).');
        }
        for (const y of spec.y) {
            requireColumn(columnMap, y, 'measure');
            ensureNumeric(y, rows);
        }
        return;
    }

    if (spec.chartType === 'scatter' || spec.chartType === 'bubble') {
        requireColumn(columnMap, spec.x, 'x');
        requireColumn(columnMap, spec.y[0], 'y');
        ensureNumeric(spec.x!, rows);
        ensureNumeric(spec.y[0], rows);
        if (spec.chartType === 'bubble') {
            requireColumn(columnMap, spec.size, 'size');
            ensureNumeric(spec.size!, rows);
        }
        return;
    }

    requireColumn(columnMap, spec.x, 'x');
    if (spec.y.length === 0) {
        throw new ChartBuildError('At least one measure column (y) is required.');
    }
    for (const y of spec.y) {
        requireColumn(columnMap, y, 'measure');
        ensureNumeric(y, rows);
    }
    if (spec.series) requireColumn(columnMap, spec.series, 'series');
    for (const y of spec.y2 || []) {
        requireColumn(columnMap, y, 'secondary measure');
        ensureNumeric(y, rows);
    }
    if (spec.chartType === 'heatmap' && !spec.series) {
        throw new ChartBuildError(
            'A heatmap needs a series column for the second dimension (x = columns, series = rows).'
        );
    }
    if (spec.chartType === 'percentBar' && !spec.series) {
        // A single-series percent chart is still meaningful (share of total),
        // but make the warning explicit.

    }
    if (!NUMERIC_TYPES.has(spec.chartType)) {
        throw new ChartBuildError(`Unsupported chart type "${spec.chartType}".`);
    }
}

export function buildChartFromSpec(
    artifact: QueryArtifact,
    inputSpec: Partial<ChartSpec> | undefined,
    options: BuildChartOptions = {}
): ChartPayload {
    return buildChartFromRows(
        artifact.columns,
        rowsToObjects(artifact),
        inputSpec,
        {
            ...options,
            queryId: options.queryId ?? artifact.id,
            sql: options.sql ?? artifact.sql,
            tables: options.tables ?? artifact.tables,
        },
        artifact.rowCount
    );
}

export function buildChartFromRows(
    columns: ChartColumn[],
    rows: Record<string, unknown>[],
    inputSpec: Partial<ChartSpec> | undefined,
    options: BuildChartOptions = {},
    totalRowCount?: number
): ChartPayload {
    if (!Array.isArray(columns) || columns.length === 0) {
        throw new ChartBuildError('The query returned no columns, so there is nothing to chart.');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new ChartBuildError('The query returned no rows, so there is nothing to chart.');
    }

    const spec = normalizeChartSpec(inputSpec, columns);
    validateSpec(spec, rows, columns);

    const warnings: string[] = [];
    const theme = options.theme || spec.theme || 'default';
    const palette = themePalette(theme);
    const title =
        options.title ||
        spec.title ||
        (spec.chartType === 'table'
            ? '数据表'
            : spec.chartType === 'kpi'
              ? spec.y.join(' / ')
              : `${spec.y.join(', ')} by ${spec.x}`);

    let option: Record<string, unknown> = {};
    let kpis: ChartKpi[] | undefined;

    switch (spec.chartType) {
        case 'kpi':
            kpis = buildKpis(rows, spec, warnings);
            break;
        case 'table':
            break;
        case 'pie':
        case 'donut':
            option = buildPieOption(rows, spec, palette, warnings);
            break;
        case 'scatter':
        case 'bubble':
            option = buildScatterOption(rows, spec, palette, warnings);
            break;
        case 'heatmap':
            option = buildHeatmapOption(rows, spec, palette, warnings);
            break;
        case 'combo':
            option = buildCartesianOption(rows, spec, palette, warnings, true, columns);
            break;
        default:
            option = buildCartesianOption(rows, spec, palette, warnings, false, columns);
            break;
    }

    return {
        queryId: options.queryId,
        chartType: spec.chartType,
        title,
        explanation: options.explanation || spec.explanation,
        columns,
        rows: spec.chartType === 'table' ? rows.slice(0, 500) : rows,
        encoding: {
            x: spec.x,
            y: spec.y,
            series: spec.series,
            size: spec.size,
        },
        option,
        warnings,
        spec,
        kpis,
        sql: options.sql,
        tables: options.tables,
        datasetIds: options.datasetIds,
        theme,
        generatedAt: Date.now(),
        rowCount: totalRowCount ?? rows.length,
    };
}

function aggregateValues(values: number[], aggregate: ChartAggregate): number | null {
    if (values.length === 0) return null;
    switch (aggregate) {
        case 'avg':
            return values.reduce((sum, value) => sum + value, 0) / values.length;
        case 'min':
            return Math.min(...values);
        case 'max':
            return Math.max(...values);
        case 'count':
            return values.length;
        case 'none':
            return values[values.length - 1];
        case 'sum':
        default:
            return values.reduce((sum, value) => sum + value, 0);
    }
}

function aggregateLabel(aggregate: ChartAggregate): string {
    switch (aggregate) {
        case 'avg':
            return '平均值';
        case 'min':
            return '最小值';
        case 'max':
            return '最大值';
        case 'count':
            return '数量';
        default:
            return '汇总';
    }
}

interface Group {
    name: string;
    rows: Record<string, unknown>[];
}

function groupRows(rows: Record<string, unknown>[], series: string | undefined): Group[] {
    if (!series) return [{ name: '', rows }];
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
        const key = label(row[series]);
        const group = groups.get(key) || [];
        group.push(row);
        groups.set(key, group);
    }
    return Array.from(groups, ([name, groupRowsList]) => ({
        name,
        rows: groupRowsList,
    }));
}

interface CategoryMatrix {
    categories: string[];
    /** One entry per group, each aligned with `categories`. */
    groups: Array<{ name: string; values: Map<string, number | null>[] }>;
    duplicate: boolean;
}

function buildCategoryMatrix(
    rows: Record<string, unknown>[],
    groups: Group[],
    x: string,
    yColumns: string[],
    aggregate: ChartAggregate
): CategoryMatrix {
    const categories: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const value = label(row[x]);
        if (!seen.has(value)) {
            seen.add(value);
            categories.push(value);
        }
    }

    let duplicate = false;
    const resultGroups = groups.map((group) => {
        const valueMaps = yColumns.map(() => new Map<string, number[]>());
        for (const row of group.rows) {
            const category = label(row[x]);
            yColumns.forEach((column, index) => {
                const value = asNumber(row[column]);
                if (value === null) return;
                const list = valueMaps[index].get(category) || [];
                list.push(value);
                valueMaps[index].set(category, list);
            });
        }
        const aggregated = valueMaps.map((map) => {
            const output = new Map<string, number | null>();
            for (const category of categories) {
                const values = map.get(category) || [];
                if (values.length > 1) duplicate = true;
                output.set(category, aggregateValues(values, aggregate));
            }
            return output;
        });
        return { name: group.name, values: aggregated };
    });

    return { categories, groups: resultGroups, duplicate };
}

function sortCategories(
    categories: string[],
    matrix: CategoryMatrix,
    spec: ChartSpec,
    xType: string | undefined,
    yIndex: number
): string[] {
    const sorted = [...categories];
    if (spec.sort) {
        const order = spec.sort.order === 'desc' ? -1 : 1;
        const by = spec.sort.by;
        if (by === 'x') {
            sorted.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }) * order);
        } else {
            const index =
                yIndex >= 0 && spec.y[yIndex]
                    ? yIndex
                    : Math.max(0, spec.y.indexOf(by));
            sorted.sort((a, b) => {
                const av = sumCategory(matrix, a, index);
                const bv = sumCategory(matrix, b, index);
                return (av - bv) * order;
            });
        }
    } else if (isTemporalType(xType)) {
        sorted.sort((a, b) => a.localeCompare(b));
    }
    return sorted;
}

function sumCategory(matrix: CategoryMatrix, category: string, yIndex: number): number {
    let total = 0;
    for (const group of matrix.groups) {
        const value = group.values[yIndex]?.get(category);
        if (typeof value === 'number') total += value;
    }
    return total;
}

function makeFormatter(format: ChartValueFormat | undefined): (value: unknown) => string {
    return (value: unknown) => formatValue(value, format);
}

function formatValue(value: unknown, format: ChartValueFormat | undefined): string {
    const number = asNumber(value);
    if (number === null) return value === null || value === undefined ? '—' : String(value);
    switch (format) {
        case 'percent':
            return `${trimNumber(number)}%`;
        case 'currency':
            return `¥${trimNumber(number)}`;
        case 'compact':
            return new Intl.NumberFormat(undefined, {
                notation: 'compact',
                maximumFractionDigits: 1,
            }).format(number);
        case 'number':
            return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
        case 'auto':
        default:
            if (Math.abs(number) >= 100_000) {
                return new Intl.NumberFormat(undefined, {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                }).format(number);
            }
            return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
    }
}

function trimNumber(value: number): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function buildPieOption(
    rows: Record<string, unknown>[],
    spec: ChartSpec,
    palette: string[],
    warnings: string[]
): Record<string, unknown> {
    const x = spec.x!;
    const y = spec.y[0];
    const aggregate = spec.aggregate || 'sum';
    const totals = new Map<string, number[]>();
    for (const row of rows) {
        const name = label(row[x]);
        const value = asNumber(row[y]);
        if (value === null) continue;
        const list = totals.get(name) || [];
        list.push(value);
        totals.set(name, list);
    }
    if (totals.size === 0) {
        throw new ChartBuildError('None of the pie values could be parsed as numbers.');
    }
    if (totals.size > 30) {
        warnings.push(`The pie chart has ${totals.size} slices; consider a bar chart instead.`);
    }

    let entries = Array.from(totals, ([name, values]) => ({
        name,
        value: aggregateValues(values, aggregate) ?? 0,
    }));
    if (spec.sort) {
        const direction = spec.sort.order === 'desc' ? -1 : 1;
        entries = entries.sort((a, b) => (a.value - b.value) * direction);
    }
    if (spec.limit) entries = entries.slice(0, spec.limit);

    const isDonut = spec.chartType === 'donut';
    return {
        tooltip: {
            trigger: 'item',
            valueFormatter: makeFormatter(spec.valueFormat),
        },
        legend: {
            type: 'scroll',
            bottom: 0,
            show: entries.length > 1,
        },
        color: palette,
        series: [
            {
                type: 'pie',
                radius: isDonut ? ['45%', '70%'] : ['12%', '66%'],
                center: ['50%', '46%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 1 },
                label: {
                    show: entries.length <= 18,
                    formatter: isDonut ? '{b}\n{d}%' : '{b}: {d}%',
                },
                labelLine: { show: entries.length <= 18 },
                emphasis: { scaleSize: 6 },
                data: entries,
            },
        ],
        animationDuration: 450,
    };
}

function buildScatterOption(
    rows: Record<string, unknown>[],
    spec: ChartSpec,
    palette: string[],
    warnings: string[]
): Record<string, unknown> {
    const x = spec.x!;
    const groups = groupRows(rows, spec.series);
    const seriesOptions: Record<string, unknown>[] = [];
    let colorIndex = 0;

    if (spec.chartType === 'bubble') {
        const sizeValues = rows
            .map((row) => asNumber(row[spec.size!]))
            .filter((value): value is number => value !== null);
        const minSize = Math.min(...sizeValues);
        const maxSize = Math.max(...sizeValues);
        const sizeRange = maxSize - minSize || 1;

        for (const group of groups) {
            const data = group.rows.flatMap((row) => {
                const xValue = asNumber(row[x]);
                const yValue = asNumber(row[spec.y[0]]);
                const sizeValue = asNumber(row[spec.size!]);
                return xValue === null || yValue === null || sizeValue === null
                    ? []
                    : [[xValue, yValue, sizeValue]];
            });
            seriesOptions.push({
                name: spec.series ? group.name : spec.y[0],
                type: 'scatter',
                symbolSize: (value: unknown) => {
                    const size = Array.isArray(value) ? asNumber(value[2]) : null;
                    if (size === null) return 10;
                    return 8 + ((size - minSize) / sizeRange) * 34;
                },
                itemStyle: { color: palette[colorIndex++ % palette.length], opacity: 0.78 },
                data,
            });
        }
    } else {
        for (const group of groups) {
            for (const y of spec.y) {
                const data = group.rows.flatMap((row) => {
                    const xValue = asNumber(row[x]);
                    const yValue = asNumber(row[y]);
                    return xValue === null || yValue === null ? [] : [[xValue, yValue]];
                });
                seriesOptions.push({
                    name: spec.series ? `${group.name} · ${y}` : y,
                    type: 'scatter',
                    symbolSize: 7,
                    itemStyle: { color: palette[colorIndex++ % palette.length] },
                    data,
                });
            }
        }
    }

    if (spec.series && groups.length > 12) {
        warnings.push(
            `The series column has ${groups.length} values; the scatter chart may be hard to read.`
        );
    }

    return {
        tooltip: {
            trigger: 'item',
            valueFormatter: makeFormatter(spec.valueFormat),
        },
        legend: {
            type: 'scroll',
            bottom: 0,
            show: seriesOptions.length > 1,
        },
        grid: { left: 56, right: 28, top: 24, bottom: seriesOptions.length > 1 ? 56 : 40 },
        xAxis: { type: 'value', name: x, nameLocation: 'middle', nameGap: 28 },
        yAxis: { type: 'value', name: spec.y.join(' / ') },
        color: palette,
        series: seriesOptions,
        animationDuration: 450,
    };
}

function buildHeatmapOption(
    rows: Record<string, unknown>[],
    spec: ChartSpec,
    palette: string[],
    warnings: string[]
): Record<string, unknown> {
    const x = spec.x!;
    const seriesColumn = spec.series!;
    const measure = spec.y[0];
    const aggregate = spec.aggregate || 'sum';

    const xCategories: string[] = [];
    const yCategories: string[] = [];
    const xSeen = new Set<string>();
    const ySeen = new Set<string>();
    const buckets = new Map<string, number[]>();

    for (const row of rows) {
        const xValue = label(row[x]);
        const yValue = label(row[seriesColumn]);
        const value = asNumber(row[measure]);
        if (!xSeen.has(xValue)) {
            xSeen.add(xValue);
            xCategories.push(xValue);
        }
        if (!ySeen.has(yValue)) {
            ySeen.add(yValue);
            yCategories.push(yValue);
        }
        if (value === null) continue;
        const key = `${xValue}\u0000${yValue}`;
        const list = buckets.get(key) || [];
        list.push(value);
        buckets.set(key, list);
    }

    if (xCategories.length * yCategories.length > 500) {
        warnings.push(
            `The heatmap has ${xCategories.length * yCategories.length} cells; consider aggregating further.`
        );
    }

    const data: number[][] = [];
    const values: number[] = [];
    yCategories.forEach((yValue, yIndex) => {
        xCategories.forEach((xValue, xIndex) => {
            const valuesForKey = buckets.get(`${xValue}\u0000${yValue}`) || [];
            const value = aggregateValues(valuesForKey, aggregate);
            if (value === null) return;
            data.push([xIndex, yIndex, value]);
            values.push(value);
        });
    });

    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;

    return {
        tooltip: {
            position: 'top',
            formatter: (params: any) => {
                const value = params?.value as number[] | undefined;
                if (!value) return '';
                return `${xCategories[value[0]] || ''} · ${yCategories[value[1]] || ''}<br/>${formatValue(
                    value[2],
                    spec.valueFormat
                )}`;
            },
        },
        grid: { left: 90, right: 28, top: 24, bottom: 64 },
        xAxis: {
            type: 'category',
            data: xCategories,
            splitArea: { show: true },
            axisLabel: { hideOverlap: true },
        },
        yAxis: {
            type: 'category',
            data: yCategories,
            splitArea: { show: true },
        },
        visualMap: {
            min,
            max,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            inRange: { color: [palette[0], '#93c5fd', '#fde68a', palette[3] || palette[0]] },
        },
        series: [
            {
                name: `${aggregateLabel(aggregate)} ${measure}`,
                type: 'heatmap',
                data,
                label: { show: xCategories.length * yCategories.length <= 80 },
                emphasis: {
                    itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.35)' },
                },
            },
        ],
        animationDuration: 400,
    };
}

function buildCartesianOption(
    rows: Record<string, unknown>[],
    spec: ChartSpec,
    palette: string[],
    warnings: string[],
    combo: boolean,
    columns: ChartColumn[]
): Record<string, unknown> {
    const x = spec.x!;
    const xType = columns.find((column) => column.name === x)?.type;
    const groups = groupRows(rows, spec.series);
    const barColumns = combo ? spec.y : spec.y;
    const lineColumns = combo ? spec.y2 || [] : [];
    const allMeasures = [...barColumns, ...lineColumns];
    const aggregate = spec.aggregate || 'sum';
    const isPercent = spec.chartType === 'percentBar';
    const isHorizontal = spec.horizontal || spec.chartType === 'hbar';
    const stacked =
        spec.chartType === 'stackedBar' ||
        spec.chartType === 'stackedArea' ||
        isPercent ||
        !!spec.stacked;

    const matrix = buildCategoryMatrix(rows, groups, x, allMeasures, aggregate);
    const primaryYIndex = 0;
    let categories = sortCategories(
        matrix.categories,
        matrix,
        spec,
        xType,
        primaryYIndex
    );
    if (spec.limit) categories = categories.slice(0, spec.limit);

    if (matrix.duplicate && aggregate !== 'none') {
        warnings.push(
            `Duplicate x values were ${aggregateLabel(aggregate)}. Add an explicit aggregation in SQL for full control.`
        );
    }
    if (matrix.duplicate && aggregate === 'none') {
        warnings.push('Duplicate x values exist; only the last value is shown. Add aggregation in SQL.');
    }
    if (groups.length > 12) {
        warnings.push(`The series column has ${groups.length} values; consider a Top N query.`);
    }
    if (categories.length > 40) {
        warnings.push(`The chart has ${categories.length} categories; use the zoom control to inspect it.`);
    }
    if (isPercent && !spec.series) {
        warnings.push('A percent chart without a series column shows each measure as 100% of the total.');
    }

    // Compute per-category denominators for 100% charts.
    const denominators: number[][] = isPercent
        ? categories.map((category) =>
              allMeasures.map((_, yIndex) => {
                  let total = 0;
                  for (const group of matrix.groups) {
                      const value = group.values[yIndex]?.get(category);
                      if (typeof value === 'number') total += value;
                  }
                  return total;
              })
          )
        : [];

    const seriesOptions: Record<string, unknown>[] = [];
    let colorIndex = 0;
    let hasSecondary = false;

    matrix.groups.forEach((group) => {
        allMeasures.forEach((measure, measureIndex) => {
            const isLine = lineColumns.includes(measure) && measureIndex >= barColumns.length;
            const values = categories.map((category, categoryIndex) => {
                const raw = group.values[measureIndex]?.get(category) ?? null;
                if (raw === null || !isPercent) return raw;
                const denominator = denominators[categoryIndex]?.[measureIndex] || 0;
                return denominator === 0 ? 0 : (raw / denominator) * 100;
            });
            const name = spec.series ? `${group.name} · ${measure}` : measure;
            const color = palette[colorIndex++ % palette.length];
            const base: Record<string, unknown> = {
                name,
                type: isLine ? 'line' : isHorizontal ? 'bar' : spec.chartType === 'line' || spec.chartType === 'area' || spec.chartType === 'stackedArea' ? 'line' : 'bar',
                data: values,
                itemStyle: { color },
                emphasis: { focus: 'series' },
            };

            if (base.type === 'line') {
                base.smooth = spec.smooth !== false;
                base.symbol = 'circle';
                base.symbolSize = 6;
                if (
                    spec.chartType === 'area' ||
                    spec.chartType === 'stackedArea' ||
                    (combo && isLine)
                ) {
                    base.areaStyle =
                        spec.chartType === 'area' || spec.chartType === 'stackedArea'
                            ? { opacity: 0.18 }
                            : undefined;
                }
                if (combo && isLine) {
                    base.yAxisIndex = 1;
                    base.smooth = true;
                    hasSecondary = true;
                }
            } else if (isHorizontal) {
                base.itemStyle = {
                    color,
                    borderRadius: [0, 4, 4, 0],
                };
            } else {
                base.itemStyle = {
                    color,
                    borderRadius: [4, 4, 0, 0],
                };
                base.barMaxWidth = 42;
            }
            if (stacked && (base.type === 'bar' || base.type === 'line')) {
                base.stack = `total-${measure}`;
            }
            if (spec.showLabels) {
                base.label = {
                    show: true,
                    position: isHorizontal ? 'right' : 'top',
                    formatter: (params: any) =>
                        formatValue(params?.value, isPercent ? 'percent' : spec.valueFormat),
                };
            }
            seriesOptions.push(base);
        });
    });

    const categoryAxis = {
        type: 'category',
        data: categories,
        axisLabel: { hideOverlap: true },
        axisTick: { alignWithLabel: true },
        splitLine: { show: false },
    };
    const valueAxis = {
        type: 'value',
        max: isPercent ? 100 : undefined,
        axisLabel: {
            formatter: isPercent ? '{value}%' : undefined,
        },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.45 } },
    };

    const option: Record<string, unknown> = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: isHorizontal ? 'shadow' : 'line' },
            valueFormatter: makeFormatter(isPercent ? 'percent' : spec.valueFormat),
        },
        legend: {
            type: 'scroll',
            bottom: 0,
            show: seriesOptions.length > 1,
        },
        grid: {
            left: isHorizontal ? 96 : 56,
            right: hasSecondary ? 64 : 28,
            top: 24,
            bottom: seriesOptions.length > 1 || categories.length > 40 ? 64 : 36,
        },
        xAxis: isHorizontal ? valueAxis : categoryAxis,
        yAxis: isHorizontal
            ? categoryAxis
            : hasSecondary
              ? [
                    valueAxis,
                    {
                        type: 'value',
                        position: 'right',
                        splitLine: { show: false },
                    },
                ]
              : valueAxis,
        color: palette,
        series: seriesOptions,
        animationDuration: 450,
    };

    if (categories.length > 40) {
        option.dataZoom = [
            {
                type: 'inside',
                xAxisIndex: isHorizontal ? undefined : 0,
                yAxisIndex: isHorizontal ? 0 : undefined,
                start: 0,
                end: 60,
            },
        ];
    }

    return option;
}

function buildKpis(
    rows: Record<string, unknown>[],
    spec: ChartSpec,
    warnings: string[]
): ChartKpi[] {
    const aggregate = spec.aggregate || 'sum';
    const x = spec.x;
    const categories: string[] = [];
    const seen = new Set<string>();
    if (x) {
        for (const row of rows) {
            const value = label(row[x]);
            if (!seen.has(value)) {
                seen.add(value);
                categories.push(value);
            }
        }
    }

    return spec.y.map((measure) => {
        const aggregateFor = (selectedRows: Record<string, unknown>[]) => {
            const values = selectedRows
                .map((row) => asNumber(row[measure]))
                .filter((value): value is number => value !== null);
            return aggregateValues(values, aggregate);
        };

        const currentRows = x && categories.length > 1
            ? rows.filter((row) => label(row[x]) === categories[categories.length - 1])
            : rows;
        const previousRows = x && categories.length > 1
            ? rows.filter((row) => label(row[x]) === categories[categories.length - 2])
            : [];
        const value = aggregateFor(currentRows);
        const previousValue = previousRows.length > 0 ? aggregateFor(previousRows) : null;
        const delta =
            value !== null && previousValue !== null ? value - previousValue : null;
        const deltaPercent =
            value !== null && previousValue !== null && previousValue !== 0
                ? ((value - previousValue) / Math.abs(previousValue)) * 100
                : null;

        if (x && categories.length > 2 && spec.sort?.by === 'x') {
            warnings.push('KPI comparison uses the last two x values, not the sorted order.');
        }

        return {
            label: measure,
            value,
            formatted: formatValue(value, spec.valueFormat),
            delta,
            deltaLabel:
                deltaPercent === null
                    ? undefined
                    : `${deltaPercent >= 0 ? '+' : ''}${trimNumber(deltaPercent)}%`,
            previousValue,
        };
    });
}

/** Stable hash of a SQL statement, used to detect definition corruption. */
export function stableSqlHash(sql: string): string {
    let hash = 0x811c9dc5;
    const text = sql.trim();
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function chartFingerprint(sql: string, spec: ChartSpec): string {
    return `${stableSqlHash(sql)}:${stableSqlHash(JSON.stringify(spec))}`;
}

/** Backwards-compatible helper for callers that only need the encoding. */
export function encodingOf(spec: ChartSpec): ChartEncoding {
    return {
        x: spec.x,
        y: spec.y,
        series: spec.series,
        size: spec.size,
    };
}
