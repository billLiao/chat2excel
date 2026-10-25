/**
 * Chart editor dialog for the dashboard (and the error-repair entry point).
 *
 * It edits the declarative ChartSpec on a saved ChartDefinition — type,
 * encoding, aggregation, sort/limit, theme and format — or replaces the saved
 * SQL when a repair is needed. The main process replays the SQL and re-runs
 * the spec validator, so an invalid edit never persists.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Wrench } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    CHART_AGGREGATES,
    CHART_THEMES,
    CHART_TYPES,
    CHART_VALUE_FORMATS,
    type ChartColumn,
    type ChartDefinition,
    type ChartPayload,
    type ChartSpec,
    type ChartType,
    type ChartUpdateResult,
} from '@/lib/charts/types';

interface ChartEditorDialogProps {
    open: boolean;
    definition: ChartDefinition | null;
    /** Latest payload, used as the column source for the pickers. */
    chart?: ChartPayload | null;
    /** 'repair' shows the SQL editor for a broken chart. */
    mode?: 'edit' | 'repair';
    error?: string | null;
    onOpenChange: (open: boolean) => void;
    onSaved?: (result: ChartUpdateResult) => void;
}

/** Chart types where a given optional field is meaningful. */
const X_TYPES: ChartType[] = [
    'bar', 'hbar', 'stackedBar', 'percentBar', 'line', 'area', 'stackedArea',
    'pie', 'donut', 'scatter', 'bubble', 'heatmap', 'combo',
];
const Y_TYPES: ChartType[] = [
    'bar', 'hbar', 'stackedBar', 'percentBar', 'line', 'area', 'stackedArea',
    'pie', 'donut', 'scatter', 'bubble', 'heatmap', 'combo', 'kpi',
];
const SERIES_TYPES: ChartType[] = [
    'bar', 'hbar', 'stackedBar', 'percentBar', 'area', 'stackedArea', 'heatmap',
];
const SORT_TYPES: ChartType[] = ['bar', 'hbar', 'pie', 'donut'];

function specSupports(spec: ChartSpec, field: 'x' | 'y' | 'series' | 'sort'): boolean {
    switch (field) {
        case 'x':
            return spec.chartType !== 'kpi' && spec.chartType !== 'table';
        case 'y':
            return spec.chartType !== 'table';
        case 'series':
            return SERIES_TYPES.includes(spec.chartType);
        case 'sort':
            return SORT_TYPES.includes(spec.chartType);
    }
}

export function ChartEditorDialog({
    open,
    definition,
    chart,
    mode = 'edit',
    error,
    onOpenChange,
    onSaved,
}: ChartEditorDialogProps) {
    const { t } = useTranslation();
    const [title, setTitle] = useState('');
    const [sql, setSql] = useState('');
    const [spec, setSpec] = useState<ChartSpec | null>(null);
    const [columns, setColumns] = useState<ChartColumn[]>([]);
    const [saving, setSaving] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    // (Re)initialize the draft whenever the dialog opens for a definition.
    useEffect(() => {
        if (!open || !definition) return;
        setLocalError(error || null);
        setTitle(definition.title);
        setSql(definition.query.sql);
        setSpec({ ...definition.spec });
    }, [open, definition, error]);

    // Column source: prefer the live payload, fall back to the table schema
    // (repair mode may have no payload at all).
    useEffect(() => {
        if (!open || !definition) return;
        let cancelled = false;
        if (chart?.columns?.length) {
            setColumns(chart.columns);
            return;
        }
        const tableName = definition.query.tables[0];
        if (!tableName) {
            setColumns([]);
            return;
        }
        window.api.db
            .getColumns(tableName)
            .then((result) => {
                if (cancelled) return;
                setColumns(
                    (result.data || []).map((column) => ({
                        name: column.name,
                        type: column.type,
                    }))
                );
            })
            .catch(() => !cancelled && setColumns([]));
        return () => {
            cancelled = true;
        };
    }, [open, definition, chart]);

    const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);

    const patchSpec = (patch: Partial<ChartSpec>) => {
        setSpec((prev) => {
            if (!prev) return prev;
            const next: ChartSpec = { ...prev, ...patch };
            // Reset encodings that no longer apply to the new type so a stale
            // field cannot fail validation after the type switch.
            if (patch.chartType && patch.chartType !== prev.chartType) {
                if (patch.chartType === 'table') {
                    next.y = [];
                    next.series = undefined;
                    next.y2 = [];
                    next.aggregate = 'none';
                } else if (patch.chartType === 'kpi') {
                    next.x = undefined;
                    next.series = undefined;
                    next.y2 = [];
                    next.sort = undefined;
                    next.limit = undefined;
                } else if (patch.chartType === 'scatter' || patch.chartType === 'bubble') {
                    next.series = undefined;
                    next.y2 = [];
                    next.aggregate = 'none';
                    next.y = next.y.slice(0, 1);
                } else if (patch.chartType === 'combo') {
                    next.y2 = next.y2?.length ? next.y2 : [];
                } else {
                    next.y2 = [];
                }
                if (!X_TYPES.includes(patch.chartType)) next.x = undefined;
                if (!Y_TYPES.includes(patch.chartType)) next.y = [];
            }
            return next;
        });
    };

    const toggleY = (name: string) => {
        if (!spec) return;
        const set = new Set(spec.y);
        if (set.has(name)) set.delete(name);
        else set.add(name);
        patchSpec({ y: columnNames.filter((column) => set.has(column)) });
    };

    const toggleY2 = (name: string) => {
        if (!spec) return;
        const set = new Set(spec.y2 || []);
        if (set.has(name)) set.delete(name);
        else set.add(name);
        patchSpec({ y2: columnNames.filter((column) => set.has(column)) });
    };

    const handleSave = async () => {
        if (!definition || !spec || saving) return;
        setSaving(true);
        setLocalError(null);
        try {
            const input: Parameters<typeof window.api.charts.update>[0] = {
                chartId: definition.id,
                spec,
                title: title.trim() || undefined,
            };
            if (mode === 'repair' && sql.trim() && sql.trim() !== definition.query.sql) {
                input.sql = sql.trim();
            }
            const result = await window.api.charts.update(input);
            if (!result.success || !result.data) {
                throw new Error(result.error || t('editor.failed'));
            }
            onSaved?.(result.data);
            onOpenChange(false);
        } catch (err: any) {
            setLocalError(err?.message || t('editor.failed'));
        } finally {
            setSaving(false);
        }
    };

    if (!definition || !spec) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-md" />
            </Dialog>
        );
    }

    const shownError = localError || error;

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {mode === 'repair' ? (
                            <Wrench className="w-4 h-4" />
                        ) : (
                            <Wrench className="w-4 h-4" />
                        )}
                        {mode === 'repair' ? t('editor.repair_title') : t('editor.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'repair'
                            ? t('editor.repair_desc')
                            : t('editor.desc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="editor-title">{t('editor.chart_title')}</Label>
                        <Input
                            id="editor-title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </div>

                    {mode === 'repair' && (
                        <div className="space-y-1.5">
                            <Label htmlFor="editor-sql">{t('editor.sql')}</Label>
                            <Textarea
                                id="editor-sql"
                                value={sql}
                                onChange={(event) => setSql(event.target.value)}
                                rows={5}
                                className="font-mono text-[11px]"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                {t('editor.sql_hint')}
                            </p>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label>{t('editor.chart_type')}</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {CHART_TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => patchSpec({ chartType: type })}
                                    className={cn(
                                        'px-2 py-1 rounded-md border text-[11px] transition-colors',
                                        spec.chartType === type
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'hover:bg-muted/60'
                                    )}
                                >
                                    {t(`editor.type_${type}`)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {specSupports(spec, 'x') && (
                            <div className="space-y-1.5">
                                <Label>{t('editor.x')}</Label>
                                <select
                                    value={spec.x || ''}
                                    onChange={(event) => patchSpec({ x: event.target.value || undefined })}
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                    <option value="">{t('editor.none')}</option>
                                    {columnNames.map((name) => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {spec.chartType === 'table' && (
                            <div className="space-y-1.5">
                                <Label>{t('editor.aggregate')}</Label>
                                <select
                                    value={spec.aggregate || 'none'}
                                    onChange={(event) =>
                                        patchSpec({ aggregate: event.target.value as ChartSpec['aggregate'] })
                                    }
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                    {CHART_AGGREGATES.map((aggregate) => (
                                        <option key={aggregate} value={aggregate}>
                                            {t(`editor.agg_${aggregate}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {specSupports(spec, 'y') && (
                        <div className="space-y-1.5">
                            <Label>{t('editor.y')}</Label>
                            <div className="flex flex-wrap gap-1.5">
                                {columnNames.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => toggleY(name)}
                                        className={cn(
                                            'px-2 py-0.5 rounded-full border text-[11px] transition-colors',
                                            spec.y.includes(name)
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'hover:bg-muted/60'
                                        )}
                                    >
                                        {name}
                                    </button>
                                ))}
                                {columnNames.length === 0 && (
                                    <span className="text-[11px] text-muted-foreground">
                                        {t('editor.no_columns')}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {specSupports(spec, 'series') && (
                        <div className="space-y-1.5">
                            <Label>{t('editor.series')}</Label>
                            <select
                                value={spec.series || ''}
                                onChange={(event) => patchSpec({ series: event.target.value || undefined })}
                                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="">{t('editor.none')}</option>
                                {columnNames.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {spec.chartType === 'combo' && (
                        <div className="space-y-1.5">
                            <Label>{t('editor.y2')}</Label>
                            <div className="flex flex-wrap gap-1.5">
                                {columnNames.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => toggleY2(name)}
                                        className={cn(
                                            'px-2 py-0.5 rounded-full border text-[11px] transition-colors',
                                            (spec.y2 || []).includes(name)
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'hover:bg-muted/60'
                                        )}
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        {spec.chartType !== 'table' && spec.chartType !== 'kpi' && (
                            <div className="space-y-1.5">
                                <Label>{t('editor.aggregate')}</Label>
                                <select
                                    value={spec.aggregate || 'sum'}
                                    onChange={(event) =>
                                        patchSpec({ aggregate: event.target.value as ChartSpec['aggregate'] })
                                    }
                                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                    {CHART_AGGREGATES.map((aggregate) => (
                                        <option key={aggregate} value={aggregate}>
                                            {t(`editor.agg_${aggregate}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label>{t('editor.theme')}</Label>
                            <select
                                value={spec.theme || 'default'}
                                onChange={(event) =>
                                    patchSpec({ theme: event.target.value as ChartSpec['theme'] })
                                }
                                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                {CHART_THEMES.map((theme) => (
                                    <option key={theme} value={theme}>
                                        {t(`editor.theme_${theme}`)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <Label>{t('editor.value_format')}</Label>
                            <select
                                value={spec.valueFormat || 'auto'}
                                onChange={(event) =>
                                    patchSpec({ valueFormat: event.target.value as ChartSpec['valueFormat'] })
                                }
                                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                {CHART_VALUE_FORMATS.map((format) => (
                                    <option key={format} value={format}>
                                        {t(`editor.fmt_${format}`)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {specSupports(spec, 'sort') && (
                            <>
                                <div className="space-y-1.5">
                                    <Label>{t('editor.sort_by')}</Label>
                                    <select
                                        value={spec.sort?.by || ''}
                                        onChange={(event) =>
                                            patchSpec({
                                                sort: event.target.value
                                                    ? {
                                                          by: event.target.value,
                                                          order: spec.sort?.order || 'desc',
                                                      }
                                                    : undefined,
                                            })
                                        }
                                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                    >
                                        <option value="">{t('editor.none')}</option>
                                        {columnNames.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{t('editor.sort_order')}</Label>
                                    <select
                                        value={spec.sort?.order || 'desc'}
                                        onChange={(event) =>
                                            spec.sort &&
                                            patchSpec({
                                                sort: { by: spec.sort.by, order: event.target.value as 'asc' | 'desc' },
                                            })
                                        }
                                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                    >
                                        <option value="desc">{t('editor.sort_desc')}</option>
                                        <option value="asc">{t('editor.sort_asc')}</option>
                                    </select>
                                </div>
                            </>
                        )}
                    </div>

                    {specSupports(spec, 'sort') && (
                        <div className="space-y-1.5">
                            <Label htmlFor="editor-limit">{t('editor.limit')}</Label>
                            <Input
                                id="editor-limit"
                                type="number"
                                min={1}
                                value={spec.limit ?? ''}
                                onChange={(event) => {
                                    const value = Number(event.target.value);
                                    patchSpec({
                                        limit: Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined,
                                    });
                                }}
                                placeholder={t('editor.limit_placeholder')}
                                className="h-8 w-32"
                            />
                        </div>
                    )}

                    {shownError && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[11px] text-destructive">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="break-all">{shownError}</span>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        {t('editor.cancel')}
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {mode === 'repair' ? t('editor.repair_save') : t('editor.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
