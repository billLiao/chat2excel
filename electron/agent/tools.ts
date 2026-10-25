/**
 * System-default agent tools.
 *
 * These wrap the database and Excel capability layers so that every Chat2Excel
 * installation exposes the same, guarded analysis primitives. User-installed
 * MCP tools are appended by the runtime; they are not part of this contract.
 */

import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
    describeTable,
    getQueryPage,
    listTables,
    runQuery,
    type TableDescription,
} from '../capabilities/database';
import { exportQueryToDirectory } from '../capabilities/excel';
import { queryResults, type QueryColumn, type QueryPreview } from './result-store';
import {
    buildChartFromSpec,
    ChartBuildError,
    isChartTheme,
    isChartType,
} from '../charts/compiler';
import { CHART_AGGREGATES, CHART_TYPES, CHART_VALUE_FORMATS } from '../../src/lib/charts/types';
import type { ChartSpec } from '../../src/lib/charts/types';
import { pinChart } from '../charts/refresh';
import { db } from '../db';
import { getEnabledSkills, readSkill } from '../agents';
import type { AskUserAnswer, AskUserOption, AskUserRequest } from '../../src/lib/agent/message';

export interface DefaultToolContext {
    /** Tables selected in the chat context; omitted means every imported table. */
    contextTables?: string[];
    /** Query artifacts created during this conversation. */
    queryIds: Set<string>;
    /** Session that owns this tool set, recorded as chart provenance. */
    sessionId?: string;
    /**
     * Interactive question channel. The runtime wires this so the tool call
     * pauses the run until the user answers (or a timeout expires).
     */
    askUser?: (toolCallId: string, request: AskUserRequest) => Promise<AskUserAnswer>;
}

const MAX_PAGE_ROWS = 200;
const MAX_SKILL_CHARS = 80_000;
const MAX_ASK_OPTIONS = 6;

export async function createDefaultAgentTools(
    context: DefaultToolContext
): Promise<AgentTool<any, any>[]> {
    return [
        createListTablesTool(context),
        createDescribeTableTool(context),
        createQueryTool(context),
        createReadPageTool(context),
        createChartTool(context),
        createExportTool(context),
        createSkillTool(),
        createAskUserTool(context),
    ];
}

function createListTablesTool(context: DefaultToolContext): AgentTool<any, any> {
    return {
        name: 'list_tables',
        label: '列出数据表',
        description:
            'List the tables available in this conversation with their display names, row counts and user-provided descriptions. ' +
            'Call this first when you are unsure which tables exist. It does not return columns; use describe_table for that.',
        parameters: Type.Object({}),
        execute: async () => {
            const tables = await listTables(context.contextTables);
            if (tables.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text:
                                'No tables are available in this conversation. Ask the user to import an Excel/CSV file first ' +
                                'or select tables in the chat context.',
                        },
                    ],
                    details: { kind: 'catalog', tables: [] },
                };
            }

            const lines = [`Available tables (${tables.length}):`];
            tables.forEach((table, index) => {
                const display =
                    table.displayName && table.displayName !== table.name
                        ? ` (${table.displayName})`
                        : '';
                lines.push(
                    `${index + 1}. ${table.name}${display} - ${table.rowCount.toLocaleString()} rows` +
                        (table.description ? `\n   ${table.description}` : '')
                );
            });
            lines.push('');
            lines.push(
                'Use the physical table name from this list in SQL. Call describe_table before writing SQL against a table you have not inspected.'
            );

            return {
                content: [{ type: 'text', text: lines.join('\n') }],
                details: { kind: 'catalog', tables },
            };
        },
    };
}

function createDescribeTableTool(context: DefaultToolContext): AgentTool<any, any> {
    const parameters = Type.Object({
        tableName: Type.String({
            description: 'Physical table name exactly as returned by list_tables.',
        }),
        sampleRows: Type.Optional(
            Type.Number({
                description: 'Rows of sample data to show, 1-20. Defaults to 5.',
            })
        ),
    });

    return {
        name: 'describe_table',
        label: '查看表结构',
        description:
            'Inspect one table before writing SQL: column names/types/descriptions, row count, min/max, approximate distinct ' +
            'counts, null rate and a small sample. Use this to learn real values, date formats and categorical labels.',
        parameters,
        execute: async (_toolCallId: string, params: any) => {
            const sampleRows =
                typeof params.sampleRows === 'number'
                    ? Math.max(1, Math.min(20, Math.floor(params.sampleRows)))
                    : 5;
            const description = await describeTable(
                params.tableName,
                context.contextTables,
                sampleRows
            );
            return {
                content: [{ type: 'text', text: formatTableDescription(description) }],
                details: { kind: 'profile', profile: description },
            };
        },
    };
}

function createQueryTool(context: DefaultToolContext): AgentTool<any, any> {
    const parameters = Type.Object({
        sql: Type.String({
            description:
                'A single DuckDB SELECT statement. No semicolons, DDL, DML, file readers or table functions. ' +
                'Use aggregations and LIMIT; the default row cap is 2000.',
        }),
    });

    return {
        name: 'query_database',
        label: '查询数据',
        description:
            'Run one read-only SELECT against the imported tables. Returns a queryId, column types and the first 50 rows. ' +
            'Prefer aggregations (GROUP BY, date_trunc, window functions) over dumping detail rows. ' +
            'Only tables listed by list_tables are allowed.',
        parameters,
        execute: async (_toolCallId: string, params: any) => {
            const { artifact, preview } = await runQuery(params.sql, {
                contextTables: context.contextTables,
            });
            context.queryIds.add(artifact.id);
            return {
                content: [{ type: 'text', text: formatQueryPreview(preview) }],
                details: { kind: 'query', query: preview },
            };
        },
    };
}

function createReadPageTool(context: DefaultToolContext): AgentTool<any, any> {
    const parameters = Type.Object({
        queryId: Type.String({ description: 'The queryId returned by query_database.' }),
        offset: Type.Optional(
            Type.Number({ description: 'Zero-based row offset. Defaults to 50.' })
        ),
        limit: Type.Optional(
            Type.Number({ description: 'Rows to return, 1-200. Defaults to 50.' })
        ),
    });

    return {
        name: 'read_query_page',
        label: '翻页查看结果',
        description:
            'Read another page of a previous query result. Use it when the user asks for more detail than the 50-row preview, ' +
            'or to verify outliers. Do not use it to scan a whole table.',
        parameters,
        execute: async (_toolCallId: string, params: any) => {
            if (!context.queryIds.has(params.queryId)) {
                throw new Error(
                    'The queryId does not belong to this conversation. Run query_database first.'
                );
            }
            const offset =
                typeof params.offset === 'number' ? Math.max(0, Math.floor(params.offset)) : 50;
            const limit =
                typeof params.limit === 'number'
                    ? Math.max(1, Math.min(MAX_PAGE_ROWS, Math.floor(params.limit)))
                    : 50;
            const page = getQueryPage(params.queryId, offset, limit);
            return {
                content: [
                    {
                        type: 'text',
                        text: formatRows(page.columns, page.rows, {
                            queryId: page.queryId,
                            total: page.rowCount,
                            offset: page.offset,
                            returned: page.returnedRows,
                            truncated: page.truncated,
                        }),
                    },
                ],
                details: { kind: 'query_page', page },
            };
        },
    };
}

/**
 * Map physical table names used by a query back to their stable dataset ids.
 * Saved charts keep these ids so a reimport can be detected and the chart can
 * still be refreshed against the same logical dataset.
 */
async function datasetIdsForTables(tables: string[]): Promise<string[]> {
    if (!tables.length) return [];
    try {
        const datasets = await db.getDatasets();
        const wanted = new Set(tables.map((table) => table.toLowerCase()));
        return datasets
            .filter((dataset) => wanted.has(dataset.physicalName.toLowerCase()))
            .map((dataset) => dataset.id);
    } catch {
        return [];
    }
}

function createChartTool(context: DefaultToolContext): AgentTool<any, any> {
    const parameters = Type.Object({
        queryId: Type.String({ description: 'The queryId returned by query_database.' }),
        chartType: Type.String({
            description: `One of: ${CHART_TYPES.join(', ')}.`,
        }),
        x: Type.Optional(
            Type.String({
                description: 'Category / x-axis column (pie and donut labels, scatter x).',
            })
        ),
        y: Type.Optional(
            Type.Union([Type.String(), Type.Array(Type.String())], {
                description: 'Numeric measure column(s). Required for every chart except table.',
            })
        ),
        series: Type.Optional(
            Type.String({
                description:
                    'Optional column that splits series/colors/stacked segments; required for heatmap.',
            })
        ),
        size: Type.Optional(
            Type.String({ description: 'Bubble chart size column (numeric).' })
        ),
        y2: Type.Optional(
            Type.Array(Type.String(), {
                description: 'Secondary-axis measures for combo charts.',
            })
        ),
        aggregate: Type.Optional(
            Type.String({
                description: `How to aggregate duplicate x values: ${CHART_AGGREGATES.join(
                    ', '
                )}. Defaults to sum (none for scatter/bubble/table).`,
            })
        ),
        sortBy: Type.Optional(
            Type.String({ description: 'Column to sort categories by, usually the y column.' })
        ),
        sortOrder: Type.Optional(
            Type.String({ description: 'asc or desc. Defaults to desc when sortBy is set.' })
        ),
        limit: Type.Optional(
            Type.Number({ description: 'Keep only the top N points after sorting.' })
        ),
        theme: Type.Optional(
            Type.String({ description: 'Visual theme: default, economist, swiss, ocean, sunset, forest, slate.' })
        ),
        smooth: Type.Optional(Type.Boolean({ description: 'Smooth line/area curves.' })),
        showLabels: Type.Optional(Type.Boolean({ description: 'Show values on marks.' })),
        stacked: Type.Optional(Type.Boolean({ description: 'Stack series.' })),
        horizontal: Type.Optional(Type.Boolean({ description: 'Horizontal bar orientation.' })),
        valueFormat: Type.Optional(
            Type.String({ description: `Axis/value format: ${CHART_VALUE_FORMATS.join(', ')}.` })
        ),
        title: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        explanation: Type.Optional(
            Type.String({ description: 'One sentence describing the insight, shown under the title.' })
        ),
        saveToDashboard: Type.Optional(
            Type.Boolean({
                description:
                    'Set true when the user asks to subscribe/save/add this chart to a dashboard. ' +
                    'The chart SQL and encoding are saved so it can refresh later without the model.',
            })
        ),
        dashboardName: Type.Optional(
            Type.String({
                description: 'Target dashboard name for saveToDashboard; defaults to the default dashboard.',
            })
        ),
        refreshMode: Type.Optional(
            Type.String({
                description:
                    "live (default, re-runs SQL on refresh) or snapshot (freezes current rows).",
            })
        ),
    });

    return {
        name: 'create_chart',
        label: '生成图表',
        description:
            'Create a chart from a previous query result. Pass the queryId returned by query_database and choose x/y columns from that result. ' +
            'The chart is built from the actual rows, so never supply chart data or ECharts JSON yourself. ' +
            'Supported types: bar, hbar, stackedBar, percentBar, line, area, stackedArea, pie, donut, scatter, bubble, heatmap, combo, kpi, table. ' +
            'Aggregate before charting; a chart with many raw rows is unreadable. ' +
            'When the user wants to keep a chart on their dashboard, set saveToDashboard=true (optionally dashboardName/refreshMode).',
        parameters,
        execute: async (toolCallId: string, params: any) => {
            if (!context.queryIds.has(params.queryId)) {
                throw new Error(
                    'The queryId does not belong to this conversation. Run query_database first.'
                );
            }
            if (!isChartType(params.chartType)) {
                throw new ChartBuildError(
                    `chartType must be one of ${CHART_TYPES.join(', ')}.`
                );
            }
            if (params.theme && !isChartTheme(params.theme)) {
                throw new ChartBuildError(
                    'theme must be one of default, economist, swiss, ocean, sunset, forest, slate.'
                );
            }

            const artifact = queryResults.require(params.queryId);
            const y = Array.isArray(params.y)
                ? params.y
                : typeof params.y === 'string' && params.y
                  ? [params.y]
                  : [];
            const sort =
                typeof params.sortBy === 'string' && params.sortBy
                    ? {
                          by: params.sortBy,
                          order: params.sortOrder === 'asc' ? ('asc' as const) : ('desc' as const),
                      }
                    : undefined;
            const spec: Partial<ChartSpec> = {
                chartType: params.chartType,
                x: params.x,
                y,
                series: params.series,
                size: params.size,
                y2: Array.isArray(params.y2) ? params.y2 : undefined,
                aggregate: params.aggregate,
                sort,
                limit: typeof params.limit === 'number' ? params.limit : undefined,
                theme: params.theme,
                smooth: params.smooth,
                showLabels: params.showLabels,
                stacked: params.stacked || params.chartType === 'stackedBar' || params.chartType === 'stackedArea',
                horizontal: params.horizontal || params.chartType === 'hbar',
                valueFormat: params.valueFormat,
                title: params.title,
                subtitle: params.subtitle,
                explanation: params.explanation,
            };

            const datasetIds = await datasetIdsForTables(artifact.tables);
            const chart = buildChartFromSpec(artifact, spec, {
                queryId: params.queryId,
                title: params.title,
                explanation: params.explanation,
                sql: artifact.sql,
                tables: artifact.tables,
                datasetIds,
            });

            let pinned: {
                chartId: string;
                dashboardId: string;
                dashboardName: string;
                mode: string;
                reused: boolean;
            } | null = null;
            let pinError: string | null = null;

            if (params.saveToDashboard === true) {
                try {
                    const mode = params.refreshMode === 'snapshot' ? 'snapshot' : 'live';
                    const result = await pinChart({
                        chart,
                        dashboardName: params.dashboardName,
                        titleOverride: params.title,
                        description: params.explanation,
                        mode,
                        provenance: {
                            sessionId: context.sessionId,
                            toolCallId,
                        },
                    });
                    pinned = {
                        chartId: result.chart.id,
                        dashboardId: result.dashboard.id,
                        dashboardName: result.dashboard.name,
                        mode: result.chart.refresh.mode,
                        reused: result.reused,
                    };
                } catch (error: any) {
                    pinError = error?.message || String(error);
                }
            }

            const warningText = chart.warnings.length
                ? ` Warnings: ${chart.warnings.join(' ')}`
                : '';
            const pinText = pinned
                ? ` Saved to dashboard "${pinned.dashboardName}" (${pinned.mode} refresh${
                      pinned.reused ? ', existing definition reused' : ''
                  }).`
                : pinError
                  ? ` Saving to the dashboard failed: ${pinError}`
                  : '';
            const details: Record<string, unknown> = { kind: 'chart', chart };
            if (pinned) details.pinned = pinned;

            return {
                content: [
                    {
                        type: 'text',
                        text:
                            `Chart created from query ${chart.queryId} (${chart.chartType}, ${chart.rows.length} rows). ` +
                            `The UI shows the chart together with the source table.${warningText}${pinText}`,
                    },
                ],
                details,
            };
        },
    };
}

function createExportTool(context: DefaultToolContext): AgentTool<any, any> {
    const parameters = Type.Object({
        queryId: Type.String({
            description: 'The queryId whose result should be exported.',
        }),
        filename: Type.Optional(
            Type.String({
                description:
                    'File name without a path, e.g. "region-sales-2024". Illegal characters are removed automatically.',
            })
        ),
        format: Type.Optional(
            Type.String({
                description: 'xlsx (default) or csv.',
            })
        ),
    });

    return {
        name: 'export_query',
        label: '导出 Excel',
        description:
            'Export a previous query result as an .xlsx or .csv file into the app exports folder. ' +
            'Only use this when the user asks to download/export/save the result. ' +
            'Exports contain the rows stored in the query artifact; if the query was truncated, aggregate first.',
        parameters,
        execute: async (_toolCallId: string, params: any) => {
            if (!context.queryIds.has(params.queryId)) {
                throw new Error(
                    'The queryId does not belong to this conversation. Run query_database first.'
                );
            }
            const artifact = queryResults.require(params.queryId);
            const format = params.format === 'csv' ? 'csv' : 'xlsx';
            const filename =
                params.filename?.trim() ||
                `${artifact.tables[0] || 'chat2excel'}-${timestampSuffix()}`;

            const result = await exportQueryToDirectory(artifact, { filename, format });
            const truncationNote = artifact.truncated
                ? '\nWarning: the stored query result was truncated before export. ' +
                  'Re-run with aggregation or a higher LIMIT if the user needs every row.'
                : '';
            return {
                content: [
                    {
                        type: 'text',
                        text:
                            `Exported ${result.rowCount} rows as ${result.format.toUpperCase()}.\n` +
                            `File: ${result.filePath}${truncationNote}`,
                    },
                ],
                details: { kind: 'export', export: result },
            };
        },
    };
}

function createSkillTool(): AgentTool<any, any> {
    const parameters = Type.Object({
        name: Type.String({
            description:
                'Skill name exactly as listed in the "可用 Skills" section of the system prompt.',
        }),
    });

    return {
        name: 'read_skill',
        label: '读取 Skill',
        description:
            'Load the full instructions of an enabled Skill. Call this before following a Skill listed in the system prompt.',
        parameters,
        execute: async (_toolCallId: string, params: any) => {
            const query = params.name.trim().toLowerCase();
            const skill =
                getEnabledSkills().find(
                    (item) => item.name.toLowerCase() === query || item.id === params.name
                ) || null;
            if (!skill) {
                throw new Error(
                    `Unknown or disabled skill "${params.name}". Use one of the names listed in the system prompt.`
                );
            }
            const detail = readSkill(skill.id);
            if (!detail) throw new Error(`Failed to read skill "${params.name}".`);
            const content =
                detail.content.length > MAX_SKILL_CHARS
                    ? `${detail.content.slice(0, MAX_SKILL_CHARS)}\n\n[Skill content truncated]`
                    : detail.content;
            const files = detail.files.length
                ? `\n\nFiles in this skill (relative paths):\n${detail.files
                      .map((file) => `- ${file}`)
                      .join('\n')}`
                : '';
            const origin = skill.builtin ? ' (built-in)' : '';
            return {
                content: [
                    {
                        type: 'text',
                        text: `Skill: ${detail.name}${origin}\nSource: ${detail.path}\n\n${content}${files}`,
                    },
                ],
                details: { kind: 'skill', name: detail.name, path: detail.path },
            };
        },
    };
}

function timestampSuffix(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
        now.getHours()
    )}${pad(now.getMinutes())}`;
}

/** Normalize model-supplied ask_user parameters; tolerant of malformed shapes. */
export function normalizeAskUserRequest(params: any): AskUserRequest {
    const question = typeof params?.question === 'string' ? params.question.trim() : '';
    if (!question) {
        throw new Error('ask_user requires a non-empty "question".');
    }
    const options: AskUserOption[] | undefined = Array.isArray(params?.options)
        ? params.options
              .map((option: any): AskUserOption | null => {
                  if (typeof option === 'string' && option.trim()) {
                      return { label: option.trim() };
                  }
                  if (option && typeof option.label === 'string' && option.label.trim()) {
                      return {
                          label: option.label.trim(),
                          description:
                              typeof option.description === 'string' && option.description.trim()
                                  ? option.description.trim()
                                  : undefined,
                      };
                  }
                  return null;
              })
              .filter(
                  (option: AskUserOption | null): option is AskUserOption => option !== null
              )
              .slice(0, MAX_ASK_OPTIONS)
        : undefined;

    return {
        question,
        options: options && options.length > 0 ? options : undefined,
        multiple: params?.multiple === true,
        // Free text is always allowed unless options exist and the model
        // explicitly disables it.
        allowFreeText: options && options.length > 0 ? params?.allowFreeText !== false : true,
    };
}

export function formatAskUserAnswer(request: AskUserRequest, answer: AskUserAnswer): string {
    if (answer.timeout) {
        return (
            'The user did not answer in time. Continue with the most reasonable assumption, ' +
            'state that assumption explicitly in your reply, and do not block on this question again.'
        );
    }
    if (answer.canceled) {
        return '用户中止了本次会话。';
    }
    const selected = (answer.selected || []).filter((value) => typeof value === 'string' && value);
    const text = typeof answer.text === 'string' ? answer.text.trim() : '';
    if (selected.length === 0 && !text) {
        return '用户没有提供有效回答。请基于当前信息以最合理的口径继续，并明确说明你的假设。';
    }
    const parts: string[] = [];
    if (selected.length > 0) parts.push(`用户选择：${selected.join('；')}`);
    if (text) parts.push(`用户补充：${text}`);
    return `用户已回答你的问题（问题：${request.question}）。\n${parts.join('\n')}`;
}

function createAskUserTool(context: DefaultToolContext): AgentTool<any, any> {
    const parameters = Type.Object({
        question: Type.String({
            description:
                'One focused clarifying question, phrased in the user’s language. ' +
                'Ask before doing real work when a key requirement is ambiguous.',
        }),
        options: Type.Optional(
            Type.Array(
                Type.Object({
                    label: Type.String({
                        description: 'Short option label the user can click.',
                    }),
                    description: Type.Optional(
                        Type.String({ description: 'One line explaining this option.' })
                    ),
                }),
                {
                    description:
                        `2-${MAX_ASK_OPTIONS} concrete options when the user must choose between ` +
                        'alternatives. Omit for open questions.',
                }
            )
        ),
        multiple: Type.Optional(
            Type.Boolean({
                description: 'Allow selecting several options. Defaults to false.',
            })
        ),
        allowFreeText: Type.Optional(
            Type.Boolean({
                description: 'Allow a typed custom answer. Defaults to true.',
            })
        ),
    });

    return {
        name: 'ask_user',
        label: '向用户提问',
        description:
            'Pause the run and ask the user a clarifying question with clickable options, then continue with their answer. ' +
            'Use it BEFORE real work when a key requirement is ambiguous and cannot be inferred from the data: metric definitions ' +
            '(销售额是否含退款), time ranges, target dashboard, expected output form. Combine related doubts into one question ' +
            'or a few options; never ask trivial questions you can decide yourself, and never ask more than a couple per turn.',
        parameters,
        execute: async (toolCallId: string, params: any) => {
            if (!context.askUser) {
                throw new Error('The interactive question channel is unavailable in this context.');
            }
            const request = normalizeAskUserRequest(params);
            const answer = await context.askUser(toolCallId, request);
            if (answer.canceled) {
                throw new Error('用户中止了本次会话。');
            }
            return {
                content: [{ type: 'text', text: formatAskUserAnswer(request, answer) }],
                details: { kind: 'ask_user', question: request, answer },
            };
        },
    };
}

function formatTableDescription(description: TableDescription): string {
    const { profile } = description;
    const lines: string[] = [];
    lines.push(`Table: ${description.name}`);
    if (description.displayName && description.displayName !== description.name) {
        lines.push(`Display name: ${description.displayName}`);
    }
    if (description.description) {
        lines.push(`Description: ${description.description}`);
    }
    lines.push(`Rows: ${profile.rowCount.toLocaleString()}`);
    lines.push('');
    lines.push('Columns:');

    for (const column of description.columns) {
        const stats = profile.columns.find((item) => item.name === column.name);
        const detail: string[] = [column.type];
        if (stats?.nullPercentage !== null && stats?.nullPercentage !== undefined) {
            if (stats.nullPercentage > 0) detail.push(`${formatNumber(stats.nullPercentage)}% null`);
        }
        if (stats?.approxUnique !== null && stats?.approxUnique !== undefined) {
            detail.push(`~${formatNumber(stats.approxUnique)} distinct`);
        }
        if (stats?.min !== null && stats?.min !== undefined && stats?.max !== null) {
            detail.push(`${cellText(stats.min)}..${cellText(stats.max)}`);
        }
        if (stats?.average !== null && stats?.average !== undefined) {
            detail.push(`avg ${formatNumber(stats.average)}`);
        }
        const note = column.description ? ` - ${column.description}` : '';
        lines.push(`- ${column.name} (${detail.join(', ')})${note}`);
    }

    if (profile.sampleRows.length > 0) {
        lines.push('');
        lines.push(`Sample rows (first ${profile.sampleRows.length}):`);
        const columns: QueryColumn[] = description.columns.map((column) => ({
            name: column.name,
            type: column.type,
        }));
        lines.push(
            formatRows(columns, profile.sampleRows, {
                truncated: profile.truncatedSample,
            })
                .split('\n')
                .slice(1)
                .join('\n')
        );
    }

    return lines.join('\n');
}

function formatQueryPreview(preview: QueryPreview): string {
    const lines: string[] = [];
    lines.push(`queryId: ${preview.queryId}`);
    lines.push(
        `rows: ${preview.rowCount}${preview.truncated ? ' (result was truncated)' : ''}`
    );
    lines.push(
        `columns: ${preview.columns.map((column) => `${column.name} (${column.type})`).join(', ')}`
    );
    lines.push('');
    lines.push(
        formatRows(preview.columns, preview.rows, {
            total: preview.rowCount,
            offset: 0,
            returned: preview.returnedRows,
            truncated: preview.truncated,
        })
    );
    if (preview.truncated) {
        lines.push('');
        lines.push(
            `Only the first ${preview.rows.length} rows are shown. Use aggregation or LIMIT in SQL for a complete answer, ` +
                'or read_query_page for a later page.'
        );
    }
    return lines.join('\n');
}

function formatRows(
    columns: QueryColumn[],
    rows: Record<string, unknown>[],
    meta: {
        queryId?: string;
        total?: number;
        offset?: number;
        returned?: number;
        truncated?: boolean;
    }
): string {
    const lines: string[] = [];

    if (rows.length === 0) {
        lines.push('(no rows)');
        return lines.join('\n');
    }

    lines.push(columns.map((column) => column.name).join(' | '));
    lines.push(columns.map(() => '---').join(' | '));
    for (const row of rows) {
        lines.push(columns.map((column) => cellText(row[column.name])).join(' | '));
    }

    if (typeof meta.offset === 'number' && meta.offset > 0) {
        lines.push('');
        lines.push(`Rows ${meta.offset + 1}-${meta.offset + rows.length}`);
    }
    if (meta.truncated) {
        lines.push('');
        lines.push('(more rows exist than shown)');
    }
    return lines.join('\n');
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const singleLine = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
    return singleLine.length > 200 ? `${singleLine.slice(0, 200)}…` : singleLine;
}
