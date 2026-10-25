/**
 * "Add an existing chart to this dashboard" picker.
 *
 * Lists every saved ChartDefinition (newest first); charts already placed on
 * the target dashboard are marked instead of re-added, since addChartToDashboard
 * dedupes by chart id.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChartDefinition, Dashboard } from '@/lib/charts/types';

interface AddChartDialogProps {
    open: boolean;
    dashboard: Dashboard | null;
    onOpenChange: (open: boolean) => void;
    onAdded?: (dashboard: Dashboard) => void;
}

export function AddChartDialog({ open, dashboard, onOpenChange, onAdded }: AddChartDialogProps) {
    const { t } = useTranslation();
    const [charts, setCharts] = useState<ChartDefinition[] | null>(null);
    const [query, setQuery] = useState('');
    const [addingId, setAddingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setError(null);
        setQuery('');
        let cancelled = false;
        window.api.charts
            .list()
            .then((list) => !cancelled && setCharts(list))
            .catch((err: any) => !cancelled && setError(err?.message || String(err)));
        return () => {
            cancelled = true;
        };
    }, [open]);

    const existingIds = useMemo(
        () => new Set((dashboard?.items || []).map((item) => item.chartId)),
        [dashboard]
    );

    const filtered = useMemo(() => {
        if (!charts) return [];
        const needle = query.trim().toLowerCase();
        if (!needle) return charts;
        return charts.filter(
            (chart) =>
                chart.title.toLowerCase().includes(needle) ||
                (chart.description || '').toLowerCase().includes(needle)
        );
    }, [charts, query]);

    const handleAdd = async (chart: ChartDefinition) => {
        if (!dashboard || addingId) return;
        setAddingId(chart.id);
        setError(null);
        try {
            const result = await window.api.dashboards.addChart({
                dashboardId: dashboard.id,
                chartId: chart.id,
            });
            onAdded?.(result.dashboard);
            onOpenChange(false);
        } catch (err: any) {
            setError(err?.message || t('add_chart.failed'));
        } finally {
            setAddingId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('add_chart.title')}</DialogTitle>
                    <DialogDescription>{t('add_chart.desc')}</DialogDescription>
                </DialogHeader>

                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('add_chart.search')}
                        className="pl-8 h-8 text-xs"
                    />
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
                    {charts === null && !error && (
                        <div className="flex items-center justify-center py-8 text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                    )}
                    {charts !== null && filtered.length === 0 && (
                        <div className="py-8 text-center text-xs text-muted-foreground">
                            {t('add_chart.empty')}
                        </div>
                    )}
                    {filtered.map((chart) => {
                        const added = existingIds.has(chart.id);
                        return (
                            <div
                                key={chart.id}
                                className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-medium truncate">
                                        {chart.title}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                                        <span className="uppercase">{chart.spec.chartType}</span>
                                        <span>·</span>
                                        <span>{new Date(chart.updatedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                {added ? (
                                    <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">
                                        <Check className="w-3 h-3" />
                                        {t('add_chart.added')}
                                    </span>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 gap-1 px-2 text-[10px] shrink-0"
                                        disabled={addingId !== null}
                                        onClick={() => void handleAdd(chart)}
                                    >
                                        {addingId === chart.id ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                            <Plus className="w-3 h-3" />
                                        )}
                                        {t('add_chart.add')}
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </div>

                {error && (
                    <div className={cn('text-[11px] text-destructive break-all')}>{error}</div>
                )}
            </DialogContent>
        </Dialog>
    );
}
