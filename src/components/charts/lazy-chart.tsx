/**
 * Hydrating chart wrapper for chat history.
 *
 * Messages persisted after a session-slimming run keep only chart metadata
 * (sql/spec/columns, rows/option dropped). On first render this component
 * rebuilds the payload — via the saved definition (cache-aware) when the chart
 * was pinned, otherwise by replaying the stored SQL through the guarded query
 * path. Fully hydrated messages render directly without any fetch.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChartView } from '@/components/charts/chart-view';
import type { ChartPayload } from '@/lib/charts/types';
import type ReactECharts from 'echarts-for-react';

interface LazyChartProps {
    chart: ChartPayload;
    height?: string | number;
    maxTableRows?: number;
    className?: string;
    chartRef?: (el: ReactECharts | null) => void;
}

export function LazyChart({ chart, height, maxTableRows, className, chartRef }: LazyChartProps) {
    const { t } = useTranslation();
    const [payload, setPayload] = useState<ChartPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const runIdRef = useRef(0);

    // A slimmed message has empty rows (a compiled chart always keeps ≥1 row).
    const needsHydration = chart.rows.length === 0;

    const hydrate = async () => {
        const runId = ++runIdRef.current;
        setLoading(true);
        setError(null);
        try {
            const input = chart.chartId
                ? { chartId: chart.chartId }
                : {
                      sql: chart.sql,
                      spec: chart.spec,
                      title: chart.title,
                      explanation: chart.explanation,
                      theme: chart.theme,
                  };
            const result = await window.api.charts.rebuild(input);
            if (runId !== runIdRef.current) return;
            if (!result.success || !result.data) {
                throw new Error(result.error || t('chart.hydrate_failed'));
            }
            setPayload(result.data);
        } catch (err: any) {
            if (runId !== runIdRef.current) return;
            setError(err?.message || t('chart.hydrate_failed'));
        } finally {
            if (runId === runIdRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        if (needsHydration && !payload && !loading && !error) {
            void hydrate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsHydration, chart.chartId, chart.sql]);

    if (!needsHydration) {
        return (
            <ChartView
                chart={chart}
                height={height}
                maxTableRows={maxTableRows}
                className={className}
                chartRef={chartRef}
            />
        );
    }

    if (loading) {
        return (
            <div className="h-40 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[11px]">{t('chart.hydrating')}</span>
            </div>
        );
    }

    if (error || !payload) {
        return (
            <div className="h-40 flex flex-col items-center justify-center gap-2 text-center px-4">
                <AlertCircle className="w-4 h-4 text-destructive" />
                <div className="text-[11px] text-destructive break-all line-clamp-3">
                    {error || t('chart.hydrate_failed')}
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 text-[10px]"
                    onClick={() => void hydrate()}
                >
                    <RefreshCw className="w-3 h-3" />
                    {t('chart.retry')}
                </Button>
            </div>
        );
    }

    return (
        <ChartView
            chart={payload}
            height={height}
            maxTableRows={maxTableRows}
            className={className}
            chartRef={chartRef}
        />
    );
}
