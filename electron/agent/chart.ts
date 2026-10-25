/**
 * Agent-facing chart adapter.
 *
 * The actual compiler lives in `electron/charts/compiler.ts`; this module keeps
 * the historical `buildChart(artifact, spec)` entry point used by the agent
 * tools and older tests while exposing the declarative API to new callers.
 */

import {
    buildChartFromRows,
    buildChartFromSpec,
    ChartBuildError,
} from '../charts/compiler';
import type { ChartPayload, ChartType } from '../../src/lib/charts/types';
import type { QueryArtifact } from './result-store';

export { ChartBuildError, buildChartFromSpec, buildChartFromRows };
export type ChartDataset = ChartPayload;
export type { ChartType };

export interface LegacyChartSpec {
    queryId?: string;
    chartType: ChartType;
    x: string;
    y: string | string[];
    series?: string;
    title?: string;
    explanation?: string;
}

/**
 * Backwards-compatible builder. New code should call `buildChartFromSpec` with
 * a full `ChartSpec` (themes, aggregation, stacked/percent variants, etc.).
 */
export function buildChart(artifact: QueryArtifact, spec: LegacyChartSpec): ChartPayload {
    const y = Array.isArray(spec.y) ? spec.y : [spec.y];
    return buildChartFromSpec(
        artifact,
        {
            chartType: spec.chartType || 'bar',
            x: spec.x,
            y,
            series: spec.series,
            title: spec.title,
            explanation: spec.explanation,
            aggregate: 'sum',
        },
        {
            queryId: spec.queryId ?? artifact.id,
            title: spec.title,
            explanation: spec.explanation,
        }
    );
}
