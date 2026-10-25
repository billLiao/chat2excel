import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    Download,
    FileDown,
    ImageDown,
    LayoutDashboard,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
    X,
    GripVertical,
    MessageSquare,
    Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ChartView } from '@/components/charts/chart-view';
import { ChartEditorDialog } from '@/components/charts/chart-editor-dialog';
import { AddChartDialog } from './add-chart-dialog';
import { FilterBar } from './filter-bar';
import { cn } from '@/lib/utils';
import {
    GRID_COLUMNS,
    MIN_ITEM_HEIGHT,
    MIN_ITEM_WIDTH,
    gridRowCount,
    normalizeRect,
    type LayoutRect,
} from '@/lib/charts/layout';
import type {
    ChartDefinition,
    ChartPayload,
    ChartUpdateResult,
    Dashboard,
    DashboardExportSection,
    DashboardFilter,
    DashboardItem,
} from '@/lib/charts/types';
import type ReactECharts from 'echarts-for-react';

const GAP = 12;
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 44;

interface ItemViewState {
    chart?: ChartPayload;
    definition?: ChartDefinition;
    error?: string;
    loading?: boolean;
}

interface DragState {
    itemId: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: LayoutRect;
    colWidth: number;
}

interface EditorTarget {
    chartId: string;
    mode: 'edit' | 'repair';
    error?: string | null;
}

interface DashboardPageProps {
    onOpenChat?: () => void;
}

function formatTime(value?: number): string {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function DashboardPage({ onOpenChat }: DashboardPageProps) {
    const { t } = useTranslation();
    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [dashboard, setDashboard] = useState<Dashboard | null>(null);
    const [definitions, setDefinitions] = useState<Record<string, ChartDefinition>>({});
    const [views, setViews] = useState<Record<string, ItemViewState>>({});
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [nameDraft, setNameDraft] = useState('');
    const [gridWidth, setGridWidth] = useState(0);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [preview, setPreview] = useState<LayoutRect | null>(null);
    const [addChartOpen, setAddChartOpen] = useState(false);
    const [editor, setEditor] = useState<EditorTarget | null>(null);
    const [exporting, setExporting] = useState(false);

    const gridRef = useRef<HTMLDivElement>(null);
    const refreshTokenRef = useRef(0);
    const previewRef = useRef<LayoutRect | null>(null);
    const chartRefs = useRef<Map<string, ReactECharts>>(new Map());

    const updatePreview = (rect: LayoutRect | null) => {
        previewRef.current = rect;
        setPreview(rect);
    };

    const loadDashboards = useCallback(async (preferredId?: string) => {
        try {
            let list = await window.api.dashboards.list();
            if (list.length === 0) {
                const created = await window.api.dashboards.create();
                list = [created];
            }
            setDashboards(list);
            setCurrentId((current) => {
                const wanted = preferredId || current;
                if (wanted && list.some((entry) => entry.id === wanted)) return wanted;
                return list[0]?.id || null;
            });
        } catch (err: any) {
            setError(err?.message || t('dashboard.load_failed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadDashboards();
    }, [loadDashboards]);

    // Filters are an explicit argument (not state-derived deps): every
    // dashboards.get returns a fresh object, so a `dashboard?.filters`
    // dependency would recreate this callback per fetch and re-trigger the
    // load effect below forever.
    const refreshDashboard = useCallback(
        async (dashboardId: string, filters?: DashboardFilter[]) => {
            const token = ++refreshTokenRef.current;
            setRefreshing(true);
            setError(null);
            try {
                const result = await window.api.dashboards.refresh(
                    dashboardId,
                    false,
                    filters
                );
                if (token !== refreshTokenRef.current) return;
                const next: Record<string, ItemViewState> = {};
                for (const item of result.items) {
                    next[item.chartId] = {
                        chart: item.chart,
                        definition: item.definition,
                        error: item.error,
                    };
                }
                setViews(next);
            } catch (err: any) {
                if (token !== refreshTokenRef.current) return;
                setError(err?.message || t('dashboard.refresh_failed'));
            } finally {
                if (token === refreshTokenRef.current) setRefreshing(false);
            }
        },
        [t]
    );

    // Load the selected dashboard, its chart definitions, then refresh data.
    useEffect(() => {
        if (!currentId) return;
        let cancelled = false;
        setLoading(true);
        Promise.all([
            window.api.dashboards.get(currentId),
            window.api.charts.list(),
        ])
            .then(([selected, charts]) => {
                if (cancelled) return;
                setDashboard(selected);
                setNameDraft(selected?.name || '');
                const map: Record<string, ChartDefinition> = {};
                for (const chart of charts) map[chart.id] = chart;
                setDefinitions(map);
                setViews((prev) => {
                    const next: Record<string, ItemViewState> = {};
                    for (const item of selected?.items || []) {
                        next[item.chartId] = prev[item.chartId] || {
                            definition: map[item.chartId],
                            loading: true,
                        };
                    }
                    return next;
                });
                if (selected) void refreshDashboard(selected.id, selected.filters);
            })
            .catch((err: any) => {
                if (!cancelled) setError(err?.message || t('dashboard.load_failed'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [currentId, refreshDashboard, t]);

    // Auto refresh, driven by the dashboard policy.
    useEffect(() => {
        if (!dashboard?.autoRefresh?.enabled) return;
        const interval = Math.max(30, dashboard.autoRefresh.intervalSeconds) * 1000;
        const filters = dashboard.filters;
        const timer = window.setInterval(() => {
            void refreshDashboard(dashboard.id, filters);
        }, interval);
        return () => window.clearInterval(timer);
    }, [dashboard?.id, dashboard?.autoRefresh?.enabled, dashboard?.autoRefresh?.intervalSeconds, dashboard?.filters, refreshDashboard]);

    // Track available width so grid units map to pixels.
    useEffect(() => {
        const element = gridRef.current;
        if (!element) return;
        const update = () => setGridWidth(element.clientWidth);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [dashboard?.id]);

    const colWidth = useMemo(() => {
        if (gridWidth <= 0) return 0;
        return (gridWidth - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    }, [gridWidth]);

    const toPixels = useCallback(
        (rect: LayoutRect) => ({
            left: rect.x * (colWidth + GAP),
            top: rect.y * (ROW_HEIGHT + GAP),
            width: rect.w * colWidth + (rect.w - 1) * GAP,
            height: rect.h * ROW_HEIGHT + (rect.h - 1) * GAP,
        }),
        [colWidth]
    );

    const handlePointerDown = (
        event: React.PointerEvent,
        item: DashboardItem,
        mode: 'move' | 'resize'
    ) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        setDrag({
            itemId: item.id,
            mode,
            startX: event.clientX,
            startY: event.clientY,
            origin: { x: item.x, y: item.y, w: item.w, h: item.h },
            colWidth: colWidth + GAP,
        });
        updatePreview({ x: item.x, y: item.y, w: item.w, h: item.h });
        document.body.style.userSelect = 'none';
    };

    useEffect(() => {
        if (!drag) return;

        const handleMove = (event: PointerEvent) => {
            const dx = Math.round((event.clientX - drag.startX) / Math.max(1, drag.colWidth));
            const dy = Math.round((event.clientY - drag.startY) / (ROW_HEIGHT + GAP));
            if (drag.mode === 'move') {
                const width = drag.origin.w;
                updatePreview({
                    x: Math.max(0, Math.min(GRID_COLUMNS - width, drag.origin.x + dx)),
                    y: Math.max(0, drag.origin.y + dy),
                    w: width,
                    h: drag.origin.h,
                });
            } else {
                // Bottom-right handle: keep x/y anchored and clamp w/h so the
                // card never extends past the right edge of the grid.
                const maxW = GRID_COLUMNS - drag.origin.x;
                const w = Math.min(
                    Math.max(MIN_ITEM_WIDTH, drag.origin.w + dx),
                    maxW
                );
                updatePreview({
                    x: drag.origin.x,
                    y: drag.origin.y,
                    w,
                    h: Math.max(MIN_ITEM_HEIGHT, drag.origin.h + dy),
                });
            }
        };

        const handleUp = async () => {
            document.body.style.userSelect = '';
            const finalRect = previewRef.current;
            const itemId = drag.itemId;
            setDrag(null);
            updatePreview(null);
            if (!finalRect || !dashboard) return;
            const normalized = normalizeRect(finalRect);
            try {
                const updated = await window.api.dashboards.updateLayout({
                    dashboardId: dashboard.id,
                    layout: [{ id: itemId, ...normalized }],
                });
                if (updated) {
                    setDashboard(updated);
                    setDashboards((prev) =>
                        prev.map((entry) => (entry.id === updated.id ? updated : entry))
                    );
                }
            } catch (err: any) {
                setError(err?.message || t('dashboard.layout_failed'));
            }
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            document.body.style.userSelect = '';
        };
    }, [drag, dashboard, t]);

    const handleCreate = async () => {
        try {
            const created = await window.api.dashboards.create({
                name: newName.trim() || undefined,
            });
            setCreateOpen(false);
            setNewName('');
            await loadDashboards(created.id);
        } catch (err: any) {
            setError(err?.message || t('dashboard.create_failed'));
        }
    };

    const handleRename = async () => {
        if (!dashboard) return;
        const name = nameDraft.trim();
        if (!name || name === dashboard.name) return;
        try {
            const updated = await window.api.dashboards.update({
                dashboardId: dashboard.id,
                name,
            });
            if (updated) {
                setDashboard(updated);
                setDashboards((prev) =>
                    prev.map((entry) => (entry.id === updated.id ? updated : entry))
                );
            }
        } catch (err: any) {
            setError(err?.message || t('dashboard.rename_failed'));
        }
    };

    const handleDeleteDashboard = async () => {
        if (!dashboard) return;
        if (!window.confirm(t('dashboard.delete_confirm', { name: dashboard.name }))) {
            return;
        }
        try {
            await window.api.dashboards.delete(dashboard.id);
            const remaining = dashboards.filter((entry) => entry.id !== dashboard.id);
            setDashboards(remaining);
            setCurrentId(remaining[0]?.id || null);
            if (remaining.length === 0) await loadDashboards();
        } catch (err: any) {
            setError(err?.message || t('dashboard.delete_failed'));
        }
    };

    const handleRemoveItem = async (item: DashboardItem) => {
        if (!dashboard) return;
        try {
            const updated = await window.api.dashboards.removeItem({
                dashboardId: dashboard.id,
                itemId: item.id,
            });
            if (updated) {
                setDashboard(updated);
                setDashboards((prev) =>
                    prev.map((entry) => (entry.id === updated.id ? updated : entry))
                );
            }
        } catch (err: any) {
            setError(err?.message || t('dashboard.remove_failed'));
        }
    };

    const handleRefreshItem = async (item: DashboardItem) => {
        setViews((prev) => ({
            ...prev,
            [item.chartId]: { ...prev[item.chartId], loading: true, error: undefined },
        }));
        try {
            const result = await window.api.charts.refresh(
                item.chartId,
                true,
                dashboard?.filters
            );
            setViews((prev) => ({
                ...prev,
                [item.chartId]: {
                    chart: result.chart,
                    definition: result.definition,
                    error: result.error,
                },
            }));
        } catch (err: any) {
            setViews((prev) => ({
                ...prev,
                [item.chartId]: {
                    ...prev[item.chartId],
                    loading: false,
                    error: err?.message || t('dashboard.refresh_failed'),
                },
            }));
        }
    };

    const handleChartSaved = (result: ChartUpdateResult) => {
        const chartId = result.definition.id;
        setDefinitions((prev) => ({ ...prev, [chartId]: result.definition }));
        setViews((prev) => ({
            ...prev,
            [chartId]: { chart: result.chart, definition: result.definition, error: undefined },
        }));
    };

    // Columns seen across the dashboard's chart payloads: the candidate set
    // for global filters.
    const filterColumns = useMemo(() => {
        const names: string[] = [];
        const seen = new Set<string>();
        for (const view of Object.values(views)) {
            for (const column of view.chart?.columns || []) {
                if (!seen.has(column.name)) {
                    seen.add(column.name);
                    names.push(column.name);
                }
            }
        }
        return names;
    }, [views]);

    const handleFiltersChange = async (filters: DashboardFilter[]) => {
        if (!dashboard) return;
        try {
            const updated = await window.api.dashboards.update({
                dashboardId: dashboard.id,
                filters,
            });
            if (updated) {
                setDashboard(updated);
                setDashboards((prev) =>
                    prev.map((entry) => (entry.id === updated.id ? updated : entry))
                );
                await refreshDashboard(updated.id, updated.filters);
            }
        } catch (err: any) {
            setError(err?.message || t('dashboard.update_failed'));
        }
    };

    const downloadPng = (item: DashboardItem, title: string) => {
        const instance = chartRefs.current.get(item.id);
        if (!instance) return;
        const url = instance.getEchartsInstance().getDataURL({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: '#fff',
        });
        const link = document.createElement('a');
        link.download = `${title || 'chart'}.png`;
        link.href = url;
        link.click();
    };

    const exportItemCsv = async (chart: ChartPayload, title: string) => {
        setError(null);
        try {
            const result = await window.api.export.chartCsv({
                title,
                columns: chart.columns,
                rows: chart.rows,
            });
            if (!result.success && !result.canceled) {
                setError(result.error || t('dashboard.export_failed'));
            }
        } catch (err: any) {
            setError(err?.message || t('dashboard.export_failed'));
        }
    };

    const exportDashboardHtml = async () => {
        if (!dashboard || exporting) return;
        setExporting(true);
        setError(null);
        try {
            const sections: DashboardExportSection[] = [];
            for (const item of dashboard.items) {
                const view = views[item.chartId];
                const chart = view?.chart;
                if (!chart) continue;
                const title =
                    item.titleOverride || chart.title || view?.definition?.title || '图表';
                const subtitle = chart.explanation;
                const meta = `${chart.chartType} · ${chart.rows.length} 行`;
                if (chart.chartType === 'kpi') {
                    const cards = (chart.kpis || [])
                        .map(
                            (kpi) =>
                                `<div><strong>${escapeHtml(kpi.label)}</strong>: ${escapeHtml(
                                    kpi.formatted
                                )}${kpi.delta != null ? ` (${escapeHtml(String(kpi.delta))})` : ''}</div>`
                        )
                        .join('');
                    sections.push({ title, subtitle, kind: 'html', html: cards, meta });
                } else if (chart.chartType === 'table') {
                    const header = chart.columns
                        .map((column) => `<th>${escapeHtml(column.name)}</th>`)
                        .join('');
                    const rows = chart.rows
                        .slice(0, 100)
                        .map(
                            (row) =>
                                `<tr>${chart.columns
                                    .map((column) => {
                                        const value = row[column.name];
                                        return `<td>${escapeHtml(
                                            value === null || value === undefined
                                                ? ''
                                                : String(value)
                                        )}</td>`;
                                    })
                                    .join('')}</tr>`
                        )
                        .join('');
                    sections.push({
                        title,
                        subtitle,
                        kind: 'html',
                        html: `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`,
                        meta,
                    });
                } else {
                    const instance = chartRefs.current.get(item.id);
                    if (!instance) continue;
                    const image = instance
                        .getEchartsInstance()
                        .getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
                    sections.push({ title, subtitle, kind: 'png', image, meta });
                }
            }
            const activeFilters = (dashboard.filters || [])
                .map((filter) => `${filter.column}: ${filter.kind === 'date-range' ? `${filter.from || '…'}~${filter.to || '…'}` : (filter.values || []).join(', ')}`)
                .join('；');
            const result = await window.api.export.dashboardHtml({
                name: dashboard.name,
                filterNote: activeFilters || undefined,
                sections,
            });
            if (!result.success && !result.canceled) {
                setError(result.error || t('dashboard.export_failed'));
            }
        } catch (err: any) {
            setError(err?.message || t('dashboard.export_failed'));
        } finally {
            setExporting(false);
        }
    };

    const toggleAutoRefresh = async (enabled: boolean) => {
        if (!dashboard) return;
        try {
            const updated = await window.api.dashboards.update({
                dashboardId: dashboard.id,
                autoRefresh: {
                    enabled,
                    intervalSeconds: dashboard.autoRefresh?.intervalSeconds || 300,
                },
            });
            if (updated) {
                setDashboard(updated);
                setDashboards((prev) =>
                    prev.map((entry) => (entry.id === updated.id ? updated : entry))
                );
            }
        } catch (err: any) {
            setError(err?.message || t('dashboard.update_failed'));
        }
    };

    const rows = dashboard ? Math.max(6, gridRowCount(dashboard.items)) : 6;

    return (
        <div className="flex h-full overflow-hidden bg-background">
            <aside className="w-60 border-r bg-muted/20 flex flex-col shrink-0">
                <div className="p-4 border-b bg-background/50 backdrop-blur-sm">
                    <Button
                        onClick={() => setCreateOpen(true)}
                        className="w-full justify-start gap-2 shadow-sm rounded-lg font-medium"
                    >
                        <Plus className="w-4 h-4" />
                        {t('dashboard.new')}
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {dashboards.map((entry) => (
                        <button
                            key={entry.id}
                            onClick={() => setCurrentId(entry.id)}
                            className={cn(
                                'w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-2',
                                currentId === entry.id
                                    ? 'bg-muted text-foreground ring-1 ring-border shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                            )}
                        >
                            <LayoutDashboard className="w-4 h-4 shrink-0 opacity-60" />
                            <span className="text-sm font-medium truncate flex-1">
                                {entry.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                                {entry.items.length}
                            </span>
                        </button>
                    ))}
                    {dashboards.length === 0 && !loading && (
                        <div className="text-xs text-muted-foreground text-center py-8 px-2">
                            {t('dashboard.no_dashboards')}
                        </div>
                    )}
                </div>
                <div className="p-4 border-t bg-muted/10">
                    <div className="flex items-start gap-2 text-[10px] text-muted-foreground leading-relaxed">
                        <RefreshCw className="w-3 h-3 mt-0.5 shrink-0" />
                        {t('dashboard.mode_hint')}
                    </div>
                </div>
            </aside>

            <main className="flex-1 flex flex-col min-w-0">
                {error && (
                    <div className="mx-4 mt-3 flex items-center gap-2 p-2.5 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1 break-all">{error}</span>
                        <button onClick={() => setError(null)} className="underline text-[10px]">
                            {t('chat.dismiss')}
                        </button>
                    </div>
                )}
                {dashboard ? (
                    <>
                        <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap shrink-0">
                            <input
                                value={nameDraft}
                                onChange={(event) => setNameDraft(event.target.value)}
                                onBlur={handleRename}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                                    if (event.key === 'Escape') setNameDraft(dashboard.name);
                                }}
                                className="bg-transparent text-lg font-semibold outline-none border-b border-transparent focus:border-border min-w-[160px] max-w-[360px]"
                            />
                            <span className="text-[11px] text-muted-foreground">
                                {t('dashboard.chart_count', { count: dashboard.items.length })}
                            </span>
                            <div className="ml-auto flex items-center gap-2">
                                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={dashboard.autoRefresh?.enabled || false}
                                        onChange={(event) => void toggleAutoRefresh(event.target.checked)}
                                        className="h-3.5 w-3.5 accent-primary"
                                    />
                                    {t('dashboard.auto_refresh', {
                                        count: Math.round(
                                            (dashboard.autoRefresh?.intervalSeconds || 300) / 60
                                        ),
                                    })}
                                </label>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs"
                                    onClick={() => setAddChartOpen(true)}
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    {t('dashboard.add_chart')}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs"
                                    onClick={() => void exportDashboardHtml()}
                                    disabled={exporting || dashboard.items.length === 0}
                                >
                                    {exporting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Download className="w-3.5 h-3.5" />
                                    )}
                                    {t('dashboard.export')}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 text-xs"
                                    onClick={() => void refreshDashboard(dashboard.id, dashboard.filters)}
                                    disabled={refreshing}
                                >
                                    <RefreshCw
                                        className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')}
                                    />
                                    {refreshing ? t('dashboard.refreshing') : t('dashboard.refresh')}
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-destructive"
                                    title={t('dashboard.delete')}
                                    onClick={() => void handleDeleteDashboard()}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </div>

                        <div className="px-4 py-2 border-b shrink-0">
                            <FilterBar
                                dashboard={dashboard}
                                columns={filterColumns}
                                onChange={(filters) => void handleFiltersChange(filters)}
                                disabled={refreshing}
                            />
                        </div>

                        <div className="flex-1 overflow-auto p-4">
                            {dashboard.items.length === 0 ? (
                                <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 text-muted-foreground border-2 border-dashed rounded-xl">
                                    <LayoutDashboard className="w-10 h-10 opacity-40" />
                                    <div className="text-sm font-medium">{t('dashboard.empty_title')}</div>
                                    <div className="text-xs max-w-xs text-center">
                                        {t('dashboard.empty_desc')}
                                    </div>
                                    {onOpenChat && (
                                        <Button size="sm" variant="outline" className="gap-2 mt-1" onClick={onOpenChat}>
                                            <MessageSquare className="w-3.5 h-3.5" />
                                            {t('dashboard.go_to_chat')}
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div
                                    ref={gridRef}
                                    className="relative w-full"
                                    style={{
                                        height: rows * ROW_HEIGHT + (rows - 1) * GAP,
                                    }}
                                >
                                    {dashboard.items.map((item) => {
                                        const rect = preview && drag?.itemId === item.id ? preview : item;
                                        const view = views[item.chartId];
                                        const definition =
                                            view?.definition || definitions[item.chartId];
                                        const box = toPixels(rect as LayoutRect);
                                        const title =
                                            item.titleOverride ||
                                            definition?.title ||
                                            view?.chart?.title ||
                                            t('dashboard.untitled');
                                        const isSnapshot =
                                            (definition?.refresh.mode || 'live') === 'snapshot';
                                        return (
                                            <div
                                                key={item.id}
                                                className={cn(
                                                    'absolute rounded-xl border bg-card shadow-sm flex flex-col overflow-hidden group transition-shadow',
                                                    drag?.itemId === item.id && 'shadow-lg ring-1 ring-primary/40 z-20'
                                                )}
                                                style={{
                                                    left: box.left,
                                                    top: box.top,
                                                    width: Math.max(0, box.width),
                                                    height: box.height,
                                                }}
                                            >
                                                <div
                                                    className="flex items-center gap-1.5 px-3 shrink-0 border-b bg-muted/20 cursor-grab active:cursor-grabbing"
                                                    style={{ height: HEADER_HEIGHT }}
                                                    onPointerDown={(event) =>
                                                        handlePointerDown(event, item, 'move')
                                                    }
                                                >
                                                    <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                                                    <div className="text-xs font-semibold truncate flex-1">
                                                        {title}
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            'text-[9px] px-1.5 py-0.5 rounded-full border shrink-0',
                                                            isSnapshot
                                                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                                                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                                                        )}
                                                    >
                                                        {isSnapshot
                                                            ? t('dashboard.snapshot')
                                                            : t('dashboard.live')}
                                                    </span>
                                                    <button
                                                        className="p-1 rounded hover:bg-background text-muted-foreground"
                                                        title={t('dashboard.refresh_item')}
                                                        onPointerDown={(event) => event.stopPropagation()}
                                                        onClick={() => void handleRefreshItem(item)}
                                                    >
                                                        <RefreshCw
                                                            className={cn(
                                                                'w-3 h-3',
                                                                view?.loading && 'animate-spin'
                                                            )}
                                                        />
                                                    </button>
                                                    <button
                                                        className="p-1 rounded hover:bg-background text-muted-foreground"
                                                        title={t('dashboard.edit_chart')}
                                                        onPointerDown={(event) => event.stopPropagation()}
                                                        onClick={() =>
                                                            setEditor({ chartId: item.chartId, mode: 'edit' })
                                                        }
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </button>
                                                    {view?.chart &&
                                                        view.chart.chartType !== 'kpi' &&
                                                        view.chart.chartType !== 'table' && (
                                                            <button
                                                                className="p-1 rounded hover:bg-background text-muted-foreground"
                                                                title={t('dashboard.export_png')}
                                                                onPointerDown={(event) =>
                                                                    event.stopPropagation()
                                                                }
                                                                onClick={() =>
                                                                    downloadPng(item, title)
                                                                }
                                                            >
                                                                <ImageDown className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    <button
                                                        className="p-1 rounded hover:bg-background text-muted-foreground"
                                                        title={t('dashboard.export_csv')}
                                                        onPointerDown={(event) => event.stopPropagation()}
                                                        disabled={!view?.chart}
                                                        onClick={() =>
                                                            view?.chart &&
                                                            void exportItemCsv(view.chart, title)
                                                        }
                                                    >
                                                        <FileDown className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        className="p-1 rounded hover:bg-background text-muted-foreground hover:text-destructive"
                                                        title={t('dashboard.remove_item')}
                                                        onPointerDown={(event) => event.stopPropagation()}
                                                        onClick={() => void handleRemoveItem(item)}
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>

                                                <div className="flex-1 min-h-0 p-2.5">
                                                    {view?.loading && !view?.chart ? (
                                                        <div className="h-full flex items-center justify-center text-muted-foreground">
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        </div>
                                                    ) : view?.error ? (
                                                        <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-3">
                                                            <AlertCircle className="w-4 h-4 text-destructive" />
                                                            <div className="text-[11px] text-destructive line-clamp-3">
                                                                {view.error}
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-6 text-[10px]"
                                                                    onClick={() => void handleRefreshItem(item)}
                                                                >
                                                                    {t('dashboard.refresh_item')}
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-6 gap-1 text-[10px]"
                                                                    onClick={() =>
                                                                        setEditor({
                                                                            chartId: item.chartId,
                                                                            mode: 'repair',
                                                                            error: view.error,
                                                                        })
                                                                    }
                                                                >
                                                                    <Wrench className="w-3 h-3" />
                                                                    {t('dashboard.repair')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : view?.chart ? (
                                                        <ChartView
                                                            chart={view.chart}
                                                            height="100%"
                                                            maxTableRows={40}
                                                            className={cn(
                                                                'h-full',
                                                                view.chart.chartType === 'kpi' && 'content-start'
                                                            )}
                                                            chartRef={(el) => {
                                                                if (el) chartRefs.current.set(item.id, el);
                                                                else chartRefs.current.delete(item.id);
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="h-full flex items-center justify-center text-muted-foreground">
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="px-3 pb-1.5 flex items-center gap-2 text-[9px] text-muted-foreground shrink-0">
                                                    <span>
                                                        {t('dashboard.updated_at', {
                                                            time: formatTime(
                                                                view?.definition?.lastRefresh?.at
                                                            ),
                                                        })}
                                                    </span>
                                                    {view?.chart && (
                                                        <span className="truncate">
                                                            {view.chart.rows.length} rows
                                                        </span>
                                                    )}
                                                </div>

                                                <div
                                                    className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
                                                    onPointerDown={(event) =>
                                                        handlePointerDown(event, item, 'resize')
                                                    }
                                                >
                                                    <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-muted-foreground/40 rounded-br-sm" />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('dashboard.no_dashboards')}
                    </div>
                )}
            </main>

            <AddChartDialog
                open={addChartOpen}
                dashboard={dashboard}
                onOpenChange={setAddChartOpen}
                onAdded={(updated) => {
                    setDashboard(updated);
                    setDashboards((prev) =>
                        prev.map((entry) => (entry.id === updated.id ? updated : entry))
                    );
                    void refreshDashboard(updated.id, updated.filters);
                }}
            />

            <ChartEditorDialog
                open={!!editor}
                mode={editor?.mode || 'edit'}
                definition={editor ? definitions[editor.chartId] || null : null}
                chart={editor ? views[editor.chartId]?.chart || null : null}
                error={editor?.error || null}
                onOpenChange={(open) => {
                    if (!open) setEditor(null);
                }}
                onSaved={handleChartSaved}
            />

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('dashboard.create_title')}</DialogTitle>
                        <DialogDescription>{t('dashboard.create_desc')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="dashboard-name">{t('dashboard.name_label')}</Label>
                        <Input
                            id="dashboard-name"
                            autoFocus
                            value={newName}
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') void handleCreate();
                            }}
                            placeholder={t('dashboard.name_placeholder')}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={() => void handleCreate()}>
                            {t('dashboard.create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
