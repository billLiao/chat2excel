/**
 * Dashboard-level filter bar.
 *
 * Filters are persisted on the Dashboard and pushed down to every live chart
 * on refresh (see electron/charts/filters.ts). A filter only affects charts
 * whose result contains the filter column.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, Filter, Tags, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { Dashboard, DashboardFilter } from '@/lib/charts/types';

interface FilterBarProps {
    dashboard: Dashboard;
    /** Candidate columns, collected from the dashboard's chart payloads. */
    columns: string[];
    onChange: (filters: DashboardFilter[]) => void;
    disabled?: boolean;
}

interface DraftState {
    id?: string;
    kind: 'date-range' | 'category';
    column: string;
    from: string;
    to: string;
    valuesText: string;
}

const EMPTY_DRAFT: DraftState = {
    kind: 'date-range',
    column: '',
    from: '',
    to: '',
    valuesText: '',
};

function summarize(filter: DashboardFilter, t: (key: string, values?: any) => string): string {
    if (filter.kind === 'date-range') {
        const parts: string[] = [];
        if (filter.from) parts.push(filter.from);
        if (filter.to) parts.push(filter.to);
        return parts.join(' ~ ');
    }
    const values = filter.values || [];
    const shown = values.slice(0, 2).join(', ');
    return values.length > 2
        ? t('dashboard.filter_values_more', { shown, count: values.length })
        : shown;
}

export function FilterBar({ dashboard, columns, onChange, disabled }: FilterBarProps) {
    const { t } = useTranslation();
    const [editorOpen, setEditorOpen] = useState(false);
    const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
    const [editingIndex, setEditingIndex] = useState<number>(-1);

    const filters = dashboard.filters || [];

    const openEditor = (filter?: DashboardFilter, index = -1) => {
        setEditingIndex(index);
        setDraft(
            filter
                ? {
                      id: filter.id,
                      kind: filter.kind,
                      column: filter.column,
                      from: filter.from || '',
                      to: filter.to || '',
                      valuesText: (filter.values || []).join(', '),
                  }
                : { ...EMPTY_DRAFT, column: columns[0] || '' }
        );
        setEditorOpen(true);
    };

    const handleSaveDraft = () => {
        if (!draft.column.trim()) return;
        let next: DashboardFilter[];
        if (draft.kind === 'date-range') {
            if (!draft.from && !draft.to) return;
            const filter: DashboardFilter = {
                id: draft.id || `flt_${Date.now().toString(36)}`,
                kind: 'date-range',
                column: draft.column.trim(),
                from: draft.from || undefined,
                to: draft.to || undefined,
            };
            next =
                editingIndex >= 0
                    ? filters.map((entry, index) => (index === editingIndex ? filter : entry))
                    : [...filters, filter];
        } else {
            const values = draft.valuesText
                .split(/[,，\n]/)
                .map((value) => value.trim())
                .filter(Boolean);
            if (values.length === 0) return;
            const filter: DashboardFilter = {
                id: draft.id || `flt_${Date.now().toString(36)}`,
                kind: 'category',
                column: draft.column.trim(),
                values,
            };
            next =
                editingIndex >= 0
                    ? filters.map((entry, index) => (index === editingIndex ? filter : entry))
                    : [...filters, filter];
        }
        onChange(next.slice(0, 10));
        setEditorOpen(false);
    };

    const removeFilter = (index: number) => {
        onChange(filters.filter((_, i) => i !== index));
    };

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <Filter className="w-3 h-3 text-muted-foreground shrink-0" />
            {filters.map((filter, index) => (
                <button
                    key={filter.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => openEditor(filter, index)}
                    className={cn(
                        'group flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] max-w-[260px]',
                        disabled ? 'opacity-60' : 'hover:bg-muted'
                    )}
                    title={t('dashboard.filter_edit')}
                >
                    {filter.kind === 'date-range' ? (
                        <CalendarRange className="w-2.5 h-2.5 shrink-0" />
                    ) : (
                        <Tags className="w-2.5 h-2.5 shrink-0" />
                    )}
                    <span className="font-medium truncate">{filter.column}</span>
                    <span className="text-muted-foreground truncate">
                        {summarize(filter, t)}
                    </span>
                    <span
                        role="button"
                        tabIndex={-1}
                        className="rounded-full hover:bg-background p-0.5 shrink-0"
                        onClick={(event) => {
                            event.stopPropagation();
                            removeFilter(index);
                        }}
                    >
                        <X className="w-2.5 h-2.5" />
                    </span>
                </button>
            ))}
            <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                disabled={disabled}
                onClick={() => openEditor()}
            >
                <Filter className="w-2.5 h-2.5" />
                {t('dashboard.filter_add')}
            </Button>

            <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>
                            {editingIndex >= 0
                                ? t('dashboard.filter_edit')
                                : t('dashboard.filter_add')}
                        </DialogTitle>
                        <DialogDescription>{t('dashboard.filter_desc')}</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            {(['date-range', 'category'] as const).map((kind) => (
                                <button
                                    key={kind}
                                    type="button"
                                    onClick={() => setDraft((prev) => ({ ...prev, kind }))}
                                    className={cn(
                                        'rounded-lg border p-2 text-left transition-colors',
                                        draft.kind === kind
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                                            : 'hover:bg-muted/50'
                                    )}
                                >
                                    <div className="text-xs font-medium">
                                        {kind === 'date-range'
                                            ? t('dashboard.filter_kind_date')
                                            : t('dashboard.filter_kind_category')}
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
                                        {kind === 'date-range'
                                            ? t('dashboard.filter_kind_date_desc')
                                            : t('dashboard.filter_kind_category_desc')}
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="space-y-1.5">
                            <Label>{t('dashboard.filter_column')}</Label>
                            <select
                                value={draft.column}
                                onChange={(event) =>
                                    setDraft((prev) => ({ ...prev, column: event.target.value }))
                                }
                                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="">{t('editor.none')}</option>
                                {columns.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] text-muted-foreground">
                                {t('dashboard.filter_column_hint')}
                            </p>
                        </div>

                        {draft.kind === 'date-range' ? (
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1.5">
                                    <Label>{t('dashboard.filter_from')}</Label>
                                    <Input
                                        type="date"
                                        value={draft.from}
                                        onChange={(event) =>
                                            setDraft((prev) => ({ ...prev, from: event.target.value }))
                                        }
                                        className="h-8 text-xs"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>{t('dashboard.filter_to')}</Label>
                                    <Input
                                        type="date"
                                        value={draft.to}
                                        onChange={(event) =>
                                            setDraft((prev) => ({ ...prev, to: event.target.value }))
                                        }
                                        className="h-8 text-xs"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <Label>{t('dashboard.filter_values')}</Label>
                                <Input
                                    value={draft.valuesText}
                                    onChange={(event) =>
                                        setDraft((prev) => ({ ...prev, valuesText: event.target.value }))
                                    }
                                    placeholder={t('dashboard.filter_values_placeholder')}
                                    className="h-8 text-xs"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    {t('dashboard.filter_values_hint')}
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEditorOpen(false)}>
                            {t('dashboard.filter_cancel')}
                        </Button>
                        <Button onClick={handleSaveDraft}>{t('dashboard.filter_apply')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
