/**
 * Shared chart and dashboard contracts.
 *
 * The same shapes cross three boundaries: agent tool results, the renderer,
 * and the main-process chart store. Keep this module free of runtime imports
 * (apart from the exported constants) so it can be loaded from either side.
 */

export const CHART_TYPES = [
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
    'table',
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_AGGREGATES = ['sum', 'avg', 'min', 'max', 'count', 'none'] as const;
export type ChartAggregate = (typeof CHART_AGGREGATES)[number];

export const CHART_THEMES = [
    'default',
    'economist',
    'swiss',
    'ocean',
    'sunset',
    'forest',
    'slate',
] as const;
export type ChartThemeName = (typeof CHART_THEMES)[number];

export const CHART_VALUE_FORMATS = ['auto', 'number', 'compact', 'percent', 'currency'] as const;
export type ChartValueFormat = (typeof CHART_VALUE_FORMATS)[number];

export interface ChartSort {
    by: string;
    order: 'asc' | 'desc';
}

/**
 * A declarative encoding. It contains no rows and no ECharts JSON, so it can be
 * persisted and replayed against fresh data.
 */
export interface ChartSpec {
    chartType: ChartType;
    x?: string;
    y: string[];
    series?: string;
    /** Bubble size column. */
    size?: string;
    /** Secondary-axis line series for combo charts. */
    y2?: string[];
    aggregate?: ChartAggregate;
    sort?: ChartSort;
    limit?: number;
    theme?: ChartThemeName;
    smooth?: boolean;
    showLabels?: boolean;
    stacked?: boolean;
    horizontal?: boolean;
    valueFormat?: ChartValueFormat;
    title?: string;
    subtitle?: string;
    explanation?: string;
}

export interface ChartColumn {
    name: string;
    type: string;
}

export interface ChartKpi {
    label: string;
    value: number | null;
    formatted: string;
    /** Change versus the previous x value, when one exists. */
    delta?: number | null;
    deltaLabel?: string;
    previousValue?: number | null;
}

export interface ChartEncoding {
    x?: string;
    y: string[];
    series?: string;
    size?: string;
}

/**
 * A rendered chart. `option` is derived output and is never used as the source
 * of truth for a saved chart; `spec` + `sql` are.
 */
export interface ChartPayload {
    queryId?: string;
    /** Present when the payload belongs to a saved ChartDefinition. */
    chartId?: string;
    chartType: ChartType;
    title: string;
    explanation?: string;
    columns: ChartColumn[];
    rows: Record<string, unknown>[];
    encoding: ChartEncoding;
    option: Record<string, unknown>;
    warnings: string[];
    spec: ChartSpec;
    kpis?: ChartKpi[];
    sql?: string;
    tables?: string[];
    datasetIds?: string[];
    theme?: ChartThemeName;
    generatedAt?: number;
    rowCount?: number;
}

export interface ChartDefinitionQuery {
    kind: 'sql';
    sql: string;
    sqlHash: string;
    tables: string[];
}

export interface ChartSnapshot {
    columns: ChartColumn[];
    /** Row-major values aligned with `columns`. */
    rows: unknown[][];
    rowCount: number;
    capturedAt: number;
    dataVersion: number;
}

export interface ChartRefreshPolicy {
    mode: 'live' | 'snapshot';
    auto: boolean;
    ttlSeconds?: number;
}

export interface ChartRefreshStatus {
    at: number;
    status: 'ok' | 'error' | 'stale';
    rowCount?: number;
    dataVersion?: number;
    error?: string;
}

export interface ChartProvenance {
    sessionId?: string;
    messageId?: string;
    toolCallId?: string;
}

export interface ChartDefinition {
    id: string;
    title: string;
    description?: string;
    datasetIds: string[];
    query: ChartDefinitionQuery;
    spec: ChartSpec;
    refresh: ChartRefreshPolicy;
    snapshot?: ChartSnapshot;
    provenance?: ChartProvenance;
    fingerprint: string;
    version: number;
    createdAt: number;
    updatedAt: number;
    lastRefresh?: ChartRefreshStatus;
}

export interface DashboardItem {
    id: string;
    chartId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    titleOverride?: string;
}

export interface DashboardAutoRefresh {
    enabled: boolean;
    intervalSeconds: number;
}

/**
 * Dashboard-level filter applied on refresh. Filters are pushed onto the
 * replayed SQL as an outer WHERE over the saved query's output columns, so a
 * chart only reacts to a filter when its result actually contains the column.
 */
export interface DashboardFilter {
    id: string;
    kind: 'date-range' | 'category';
    /** Output column the filter applies to (case-insensitive match). */
    column: string;
    /** ISO date (YYYY-MM-DD) bounds for date-range filters. */
    from?: string;
    to?: string;
    /** Matched values for category filters (exact match). */
    values?: string[];
}

export interface Dashboard {
    id: string;
    name: string;
    description?: string;
    items: DashboardItem[];
    autoRefresh: DashboardAutoRefresh;
    filters?: DashboardFilter[];
    /** Storage schema version, used for forward migrations. */
    schemaVersion?: number;
    version: number;
    createdAt: number;
    updatedAt: number;
}

export interface ChartRefreshItemResult {
    chartId: string;
    success: boolean;
    chart?: ChartPayload;
    definition?: ChartDefinition;
    error?: string;
    cached?: boolean;
    refreshedAt?: number;
}

export interface DashboardRefreshResult {
    dashboardId: string;
    refreshedAt: number;
    items: ChartRefreshItemResult[];
}

export interface PinChartInput {
    chart: ChartPayload;
    dashboardId?: string;
    dashboardName?: string;
    titleOverride?: string;
    description?: string;
    mode?: 'live' | 'snapshot';
    auto?: boolean;
    provenance?: ChartProvenance;
}

export interface PinChartResult {
    chart: ChartDefinition;
    dashboard: Dashboard;
    item: DashboardItem;
    reused: boolean;
}

/** Author a saved chart from the UI (editor/repair) without the model. */
export interface ChartUpdateInput {
    chartId: string;
    /** Patch merged into the saved spec, then re-normalized against fresh rows. */
    spec?: Partial<ChartSpec>;
    title?: string;
    description?: string;
    /** Replace the saved SQL (repair path); the query is re-validated. */
    sql?: string;
}

export interface ChartUpdateResult {
    definition: ChartDefinition;
    chart: ChartPayload;
}

/** Rebuild a chart payload for chat history hydration or preview. */
export interface ChartRebuildInput {
    chartId?: string;
    sql?: string;
    spec?: Partial<ChartSpec>;
    title?: string;
    explanation?: string;
    theme?: ChartThemeName;
}

/** One chart block inside a dashboard HTML export. */
export interface DashboardExportSection {
    title: string;
    subtitle?: string;
    kind: 'png' | 'html';
    /** PNG dataURL for chart sections. */
    image?: string;
    /** Pre-rendered HTML fragment (KPI cards / table) for non-canvas charts. */
    html?: string;
    meta?: string;
}

export interface DatasetInfo {
    id: string;
    displayName: string;
    physicalName: string;
    sourceKey?: string;
    sourceKind?: string;
    sourcePath?: string;
    fingerprint?: string;
    rowCount: number;
    importVersion: number;
    updatedAt: number;
}

export interface DashboardItemView {
    item: DashboardItem;
    definition?: ChartDefinition;
    chart?: ChartPayload;
    error?: string;
    loading?: boolean;
}
