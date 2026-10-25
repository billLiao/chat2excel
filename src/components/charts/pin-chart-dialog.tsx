import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Pin } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type {
    ChartPayload,
    Dashboard,
    PinChartResult,
} from '@/lib/charts/types';

interface PinChartDialogProps {
    open: boolean;
    chart: ChartPayload | null;
    onOpenChange: (open: boolean) => void;
    onSubscribed?: (result: PinChartResult) => void;
}

const NEW_DASHBOARD = '__new__';

export function PinChartDialog({
    open,
    chart,
    onOpenChange,
    onSubscribed,
}: PinChartDialogProps) {
    const { t } = useTranslation();
    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [target, setTarget] = useState<string>(NEW_DASHBOARD);
    const [newName, setNewName] = useState('');
    const [title, setTitle] = useState('');
    const [mode, setMode] = useState<'live' | 'snapshot'>('live');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setError(null);
        setTitle(chart?.title || '');
        setMode('live');
        setAutoRefresh(false);
        let cancelled = false;
        window.api.dashboards
            .list()
            .then((list) => {
                if (cancelled) return;
                setDashboards(list);
                setTarget(list[0]?.id || NEW_DASHBOARD);
            })
            .catch((err) => {
                if (!cancelled) setError(err?.message || String(err));
            });
        return () => {
            cancelled = true;
        };
    }, [open, chart]);

    const hasSql = Boolean(chart?.sql && chart.sql.trim());
    const targetDashboard = useMemo(
        () => dashboards.find((dashboard) => dashboard.id === target),
        [dashboards, target]
    );

    const handleSubmit = async () => {
        if (!chart || !hasSql || saving) return;
        setSaving(true);
        setError(null);
        try {
            const result = await window.api.charts.pin({
                chart,
                dashboardId: target === NEW_DASHBOARD ? undefined : target,
                dashboardName:
                    target === NEW_DASHBOARD
                        ? newName.trim() || undefined
                        : undefined,
                titleOverride: title.trim() || undefined,
                mode,
                auto: autoRefresh,
            });
            if (!result.success || !result.data) {
                throw new Error(result.error || t('pin.failed'));
            }
            onSubscribed?.(result.data);
            onOpenChange(false);
        } catch (err: any) {
            setError(err?.message || t('pin.failed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Pin className="w-4 h-4" />
                        {t('pin.title')}
                    </DialogTitle>
                    <DialogDescription>{t('pin.description')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="pin-title">{t('pin.chart_title')}</Label>
                        <Input
                            id="pin-title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder={chart?.title}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="pin-dashboard">{t('pin.dashboard')}</Label>
                        <select
                            id="pin-dashboard"
                            value={target}
                            onChange={(event) => setTarget(event.target.value)}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {dashboards.map((dashboard) => (
                                <option key={dashboard.id} value={dashboard.id}>
                                    {dashboard.name} ({dashboard.items.length})
                                </option>
                            ))}
                            <option value={NEW_DASHBOARD}>{t('pin.new_dashboard_option')}</option>
                        </select>
                    </div>

                    {target === NEW_DASHBOARD && (
                        <div className="space-y-1.5">
                            <Label htmlFor="pin-new-dashboard">{t('pin.new_dashboard_name')}</Label>
                            <Input
                                id="pin-new-dashboard"
                                value={newName}
                                onChange={(event) => setNewName(event.target.value)}
                                placeholder={t('pin.new_dashboard_placeholder')}
                            />
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label>{t('pin.refresh_mode')}</Label>
                        <div className="grid grid-cols-2 gap-2">
                            {(['live', 'snapshot'] as const).map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => setMode(option)}
                                    className={cn(
                                        'rounded-lg border p-3 text-left transition-colors',
                                        mode === option
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                                            : 'hover:bg-muted/50'
                                    )}
                                >
                                    <div className="text-sm font-medium">
                                        {t(`pin.mode_${option}`)}
                                    </div>
                                    <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
                                        {t(`pin.mode_${option}_desc`)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(event) => setAutoRefresh(event.target.checked)}
                            className="h-4 w-4 rounded border-input accent-primary"
                        />
                        {t('pin.auto_refresh')}
                    </label>

                    <div className="rounded-md bg-muted/50 border p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                        {t('pin.metadata_note')}
                    </div>

                    {targetDashboard && (
                        <div className="text-[11px] text-muted-foreground">
                            {t('pin.target_hint', {
                                name: targetDashboard.name,
                                count: targetDashboard.items.length,
                            })}
                        </div>
                    )}

                    {!hasSql && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            {t('pin.no_sql')}
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[11px] text-destructive">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="break-all">{error}</span>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={saving}
                    >
                        {t('pin.cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving || !hasSql}>
                        {saving ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Pin className="w-4 h-4 mr-2" />
                        )}
                        {saving ? t('pin.saving') : t('pin.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
