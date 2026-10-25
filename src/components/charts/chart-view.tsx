import type { ChartPayload } from '@/lib/charts/types';
import { ChartRenderer } from '@/components/chat/chart-renderer';
import { cn } from '@/lib/utils';
import type ReactECharts from 'echarts-for-react';

interface ChartViewProps {
    chart: ChartPayload;
    height?: number | string;
    className?: string;
    /** Max rows rendered for table charts; keep low inside a dashboard card. */
    maxTableRows?: number;
    chartRef?: (instance: ReactECharts | null) => void;
}

function cellText(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function formatDelta(delta: number | null | undefined): string | null {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(1)}%`;
}

/**
 * Renders a compiled ChartPayload. Charts never carry ECharts JSON as their
 * source of truth: the payload option is derived, so KPI and table variants
 * can render without an ECharts instance at all.
 */
export function ChartView({
    chart,
    height = 320,
    className,
    maxTableRows = 200,
    chartRef,
}: ChartViewProps) {
    if (chart.chartType === 'kpi') {
        const kpis = chart.kpis || [];
        return (
            <div
                className={cn(
                    'grid gap-3',
                    kpis.length <= 1
                        ? 'grid-cols-1'
                        : kpis.length === 2
                          ? 'grid-cols-2'
                          : 'grid-cols-2 lg:grid-cols-3',
                    className
                )}
            >
                {kpis.map((kpi, index) => {
                    const delta = formatDelta(kpi.delta);
                    return (
                        <div
                            key={`${kpi.label}-${index}`}
                            className="rounded-xl border bg-card p-4 flex flex-col gap-1 min-w-0"
                        >
                            <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">
                                {kpi.label}
                            </div>
                            <div className="text-2xl font-semibold tabular-nums truncate">
                                {kpi.formatted}
                            </div>
                            {delta && (
                                <div
                                    className={cn(
                                        'text-[11px] font-medium tabular-nums',
                                        (kpi.delta ?? 0) >= 0
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : 'text-red-600 dark:text-red-400'
                                    )}
                                >
                                    {delta} {kpi.deltaLabel || ''}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    if (chart.chartType === 'table') {
        const columns = chart.columns;
        const rows = chart.rows.slice(0, maxTableRows);
        return (
            <div
                className={cn('overflow-auto border rounded-lg bg-background', className)}
                style={{ maxHeight: typeof height === 'number' ? height : height }}
            >
                <table className="w-full text-[11px]">
                    <thead className="bg-muted/60 sticky top-0 z-10">
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column.name}
                                    className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap border-b"
                                >
                                    {column.name}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="hover:bg-muted/40">
                                {columns.map((column) => (
                                    <td
                                        key={column.name}
                                        className="px-2.5 py-1 border-b border-border/40 whitespace-nowrap"
                                    >
                                        {cellText(row[column.name])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={columns.length || 1}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    No rows
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <div className={className} style={{ height }}>
            <ChartRenderer
                ref={(el) => chartRef?.(el)}
                options={chart.option}
                height={typeof height === 'number' ? `${height}px` : height}
            />
        </div>
    );
}
