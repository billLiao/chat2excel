import React, { useRef, useState } from 'react';
import { Bot, User, FileSpreadsheet, ImageDown, AlertCircle, Pin, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LazyChart } from '@/components/charts/lazy-chart';
import { ChartRenderer } from './chart-renderer';
import { PinChartDialog } from '@/components/charts/pin-chart-dialog';
import { QuestionCard, parseAskUserRequest } from './question-card';
import { TablePreviewModal } from './table-preview-modal';
import { Button } from '@/components/ui/button';
import type { AskUserRequest, ChatMessage } from '@/lib/agent/message';
import type { ChartPayload, PinChartResult } from '@/lib/charts/types';
import { useTranslation } from 'react-i18next';
import type ReactECharts from 'echarts-for-react';

interface MessageListProps {
    messages: ChatMessage[];
    isThinking?: boolean;
    /** ask_user tool calls waiting for an answer, keyed by toolCallId. */
    pendingQuestions?: Record<string, AskUserRequest>;
}

interface TablePreviewState {
    open: boolean;
    data: unknown[];
    columns?: string[];
    queryId?: string;
    title: string;
}

function parseArguments(raw: unknown): Record<string, any> {
    if (!raw) return {};
    if (typeof raw === 'object') return raw as Record<string, any>;
    try {
        return JSON.parse(String(raw));
    } catch {
        return {};
    }
}

export function MessageList({ messages, isThinking, pendingQuestions = {} }: MessageListProps) {
    const { t } = useTranslation();
    const chartRefs = useRef<Map<string, ReactECharts>>(new Map());
    const [tablePreview, setTablePreview] = useState<TablePreviewState>({
        open: false,
        data: [],
        title: '',
    });
    const [exportError, setExportError] = useState<string | null>(null);
    const [pinTarget, setPinTarget] = useState<ChartPayload | null>(null);
    const [pinNotice, setPinNotice] = useState<string | null>(null);

    const handleSubscribed = (result: PinChartResult) => {
        setPinNotice(
            t('chat.subscribed_notice', {
                name: result.dashboard.name,
                title: result.chart.title,
            })
        );
    };

    const handleExportQuery = async (queryId: string, title: string) => {
        setExportError(null);
        try {
            const result = await window.api.export.query(queryId, title || 'export');
            if (!result.success && !result.canceled) {
                setExportError(result.error || t('chat.export_failed'));
            }
        } catch (error: any) {
            setExportError(error?.message || t('chat.export_failed'));
        }
    };

    // 从图表配置中提取表格数据（仅用于兼容旧会话）
    const extractTableData = (option: any): any[] => {
        try {
            if (option.series && option.xAxis && option.xAxis.data) {
                const categories = option.xAxis.data;
                const rows = [];
                for (let i = 0; i < categories.length; i++) {
                    const row: any = { Category: categories[i] };
                    option.series.forEach((s: any) => {
                        row[s.name || 'Value'] = s.data[i];
                    });
                    rows.push(row);
                }
                return rows;
            }
        } catch (e) {
            console.error('Extract table data failed', e);
        }
        return [];
    };

    const openTablePreview = (option: any, title: string) => {
        const data = extractTableData(option);
        if (data.length > 0) {
            setTablePreview({ open: true, data, title });
        } else {
            console.warn('Could not extract tabular data from chart option');
        }
    };

    const handleDownloadChart = (chartId: string, title: string) => {
        const chartInstance = chartRefs.current.get(chartId);
        if (chartInstance) {
            const echartsInstance = chartInstance.getEchartsInstance();
            const url = echartsInstance.getDataURL({
                type: 'png',
                pixelRatio: 2,
                backgroundColor: '#fff',
            });
            const link = document.createElement('a');
            link.download = `${title || 'chart'}.png`;
            link.href = url;
            link.click();
        }
    };

    // Group messages for rendering
    const renderedGroups: React.JSX.Element[] = [];
    const visibleMessages = messages.filter((m) => m.role !== 'system');

    let i = 0;
    while (i < visibleMessages.length) {
        const msg = visibleMessages[i];

        if (msg.role === 'user') {
            renderedGroups.push(
                <div key={msg.id} className="flex gap-4 max-w-4xl mx-auto w-full flex-row-reverse">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-muted">
                        <User className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col gap-1 min-w-[30%] max-w-[80%] items-end">
                        <div className="text-xs text-muted-foreground">{t('chat.you')}</div>
                        <div className="rounded-2xl px-4 py-3 text-sm shadow-sm w-full bg-primary text-primary-foreground rounded-tr-sm">
                            <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                        </div>
                    </div>
                </div>
            );
            i++;
        } else {
            // It's a sequence of Assistant and Tool messages until the next User message
            const groupMessages: ChatMessage[] = [];
            let j = i;
            while (j < visibleMessages.length && visibleMessages[j].role !== 'user') {
                groupMessages.push(visibleMessages[j]);
                j++;
            }

            const groupId = groupMessages[0]?.id || `group-${i}`;
            const isLastGroup = j === visibleMessages.length;

            renderedGroups.push(
                <div key={groupId} className="flex gap-4 max-w-4xl mx-auto w-full flex-row">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-primary text-primary-foreground">
                        <Bot className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col gap-1 min-w-[30%] max-w-[80%] items-start">
                        <div className="text-xs text-muted-foreground">{t('chat.ai_analyst')}</div>
                        <div className="rounded-2xl px-4 py-3 text-sm shadow-sm w-full bg-card border rounded-tl-sm space-y-4">
                            {renderMergedContent(groupMessages, !!(isLastGroup && isThinking))}
                        </div>
                    </div>
                </div>
            );
            i = j;
        }
    }

    function renderToolResult(resultMsg: ChatMessage | undefined, isActive: boolean) {
        if (!resultMsg) {
            if (!isActive) return null;
            return (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground italic">
                    <div className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    {t('chat.thinking')}
                </div>
            );
        }

        if (resultMsg.error) {
            return (
                <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded p-2 whitespace-pre-wrap">
                    {resultMsg.content}
                </div>
            );
        }

        return null;
    }

    function renderQueryTool(
        key: string,
        args: Record<string, any>,
        resultMsg: ChatMessage | undefined,
        isActive: boolean
    ) {
        const query = resultMsg?.query;
        const previewRows = query?.rows?.slice(0, 12) || [];
        const columns = query?.columns?.map((column) => column.name) || [];

        return (
            <div
                key={key}
                className="bg-muted/30 rounded-md overflow-hidden text-[11px] border border-border/50 font-mono"
            >
                <details className="group">
                    <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors list-none">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                            {t('chat.tool_query')}
                        </span>
                        {query && (
                            <span className="text-[10px] opacity-60">
                                {t('chat.rows_returned', { count: query.rowCount })}
                            </span>
                        )}
                        {isActive && !resultMsg && (
                            <div className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin ml-2" />
                        )}
                        <div className="ml-auto transition-transform group-open:rotate-90">
                            <svg
                                className="w-3 h-3 text-muted-foreground/60"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="9 5l7 7-7 7"
                                />
                            </svg>
                        </div>
                    </summary>
                    <div className="px-2 pb-2">
                        <div className="opacity-70 whitespace-pre-wrap break-all bg-background/50 p-2 rounded border border-border/30">
                            {args.sql || '(no SQL)'}
                        </div>
                    </div>
                </details>

                {query && (
                    <div className="border-t border-border/30">
                        <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-muted-foreground">
                            <span>
                                {t('chat.rows_returned', { count: query.rowCount })}
                                {query.truncated ? ` · ${t('chat.result_truncated')}` : ''}
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 gap-1 text-[10px]"
                                onClick={() => handleExportQuery(query.queryId, query.sql)}
                            >
                                <FileSpreadsheet className="w-3 h-3" />
                                {t('chat.export_excel')}
                            </Button>
                        </div>
                        <div className="overflow-auto max-h-[220px]">
                            <table className="w-full text-[10px]">
                                <thead className="bg-background/60 sticky top-0">
                                    <tr>
                                        {columns.map((column) => (
                                            <th
                                                key={column}
                                                className="px-2 py-1 text-left font-semibold whitespace-nowrap border-b"
                                            >
                                                {column}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewRows.map((row, rowIndex) => (
                                        <tr key={rowIndex} className="hover:bg-background/40">
                                            {columns.map((column) => (
                                                <td
                                                    key={column}
                                                    className="px-2 py-0.5 border-b border-border/20 whitespace-nowrap"
                                                >
                                                    {row[column] === null ||
                                                    row[column] === undefined
                                                        ? '—'
                                                        : String(row[column])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {previewRows.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={columns.length || 1}
                                                className="px-2 py-3 text-center text-muted-foreground"
                                            >
                                                {t('data.empty')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    function renderArtifactChart(
        key: string,
        chart: NonNullable<ChatMessage['chart']>
    ) {
        const columns = chart.columns.map((column) => column.name);
        const previewRows = chart.rows.slice(0, 50);

        return (
            <div key={key} className="border rounded-lg p-4 bg-background/50 my-2">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    {chart.title}
                    <div className="ml-auto flex gap-1">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 px-2 text-[11px]"
                            title={chart.sql ? t('chat.subscribe') : t('pin.no_sql')}
                            disabled={!chart.sql}
                            onClick={() => setPinTarget(chart)}
                        >
                            <Pin className="w-3 h-3" />
                            {t('chat.subscribe')}
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            title={t('chat.download_image')}
                            onClick={() => handleDownloadChart(key, chart.title)}
                        >
                            <ImageDown className="w-4 h-4" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            title={t('chat.export_excel')}
                            disabled={!chart.queryId}
                            onClick={() =>
                                chart.queryId && handleExportQuery(chart.queryId, chart.title)
                            }
                        >
                            <FileSpreadsheet className="w-4 h-4" />
                        </Button>
                    </div>
                </h3>
                {chart.explanation && (
                    <div className="text-muted-foreground text-[11px] mb-4 leading-tight">
                        {chart.explanation}
                    </div>
                )}
                <LazyChart
                    chart={chart}
                    chartRef={(el) => {
                        if (el) chartRefs.current.set(key, el);
                    }}
                />
                {chart.warnings.length > 0 && (
                    <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 space-y-0.5">
                        {chart.warnings.map((warning, index) => (
                            <div key={index}>
                                {t('chat.chart_warnings')}: {warning}
                            </div>
                        ))}
                    </div>
                )}
                {chart.rows.length > 0 && (
                    <details className="mt-3">
                        <summary className="text-[10px] text-muted-foreground cursor-pointer select-none">
                            {t('chat.source_rows')} ({chart.rows.length})
                        </summary>
                    <div className="mt-2 overflow-auto max-h-[240px] border rounded">
                        <table className="w-full text-[10px]">
                            <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                    {columns.map((column) => (
                                        <th
                                            key={column}
                                            className="px-2 py-1 text-left font-semibold whitespace-nowrap border-b"
                                        >
                                            {column}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {previewRows.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="hover:bg-muted/30">
                                        {columns.map((column) => (
                                            <td
                                                key={column}
                                                className="px-2 py-0.5 border-b border-border/20 whitespace-nowrap"
                                            >
                                                {row[column] === null || row[column] === undefined
                                                    ? '—'
                                                    : String(row[column])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
                )}
            </div>
        );
    }

    function renderMergedContent(groupMessages: ChatMessage[], isActive: boolean) {
        const elements: React.JSX.Element[] = [];

        groupMessages.forEach((msg, idx) => {
            if (msg.role === 'assistant' && msg.thinking) {
                elements.push(
                    <details
                        key={`${msg.id}-thinking-${idx}`}
                        className="text-[11px] text-muted-foreground bg-muted/30 rounded border border-border/40 px-2 py-1"
                    >
                        <summary className="cursor-pointer select-none">{t('chat.thinking')}</summary>
                        <div className="mt-1 whitespace-pre-wrap leading-relaxed opacity-80">
                            {msg.thinking}
                        </div>
                    </details>
                );
            }

            // Text content
            if (msg.role === 'assistant' && msg.content) {
                let displayContent = msg.content;
                displayContent = displayContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                if (displayContent.includes('<think>')) {
                    displayContent = displayContent.split('<think>')[0].trim();
                }

                if (displayContent) {
                    elements.push(
                        <div
                            key={`${msg.id}-text-${idx}`}
                            className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
                        >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {displayContent}
                            </ReactMarkdown>
                        </div>
                    );
                }
            }

            if (msg.tool_calls) {
                msg.tool_calls.forEach((tc: any, tcIdx: number) => {
                    const toolName = tc?.function?.name;
                    const args = parseArguments(tc?.function?.arguments);
                    const resultMsg = messages.find(
                        (m) => m.role === 'tool' && m.tool_call_id === tc.id
                    );
                    const key = `${tc.id}-${tcIdx}`;

                    if (toolName === 'query_database') {
                        elements.push(renderQueryTool(key, args, resultMsg, isActive));
                        return;
                    }

                    if (toolName === 'ask_user') {
                        const pending = pendingQuestions[tc.id];
                        const record = resultMsg?.question;
                        const request = pending || record || parseAskUserRequest(args);
                        elements.push(
                            <QuestionCard
                                key={key}
                                request={request}
                                toolCallId={pending && !record ? tc.id : undefined}
                                record={record}
                            />
                        );
                        return;
                    }

                    if (toolName === 'create_chart') {
                        if (resultMsg?.chart) {
                            elements.push(renderArtifactChart(key, resultMsg.chart));
                        } else {
                            elements.push(
                                <div
                                    key={key}
                                    className="bg-muted/30 rounded-md p-2 text-[11px] border border-border/50"
                                >
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <div className="w-1.5 h-1.5 rounded-full bg-primary/50" />
                                        <span className="font-semibold uppercase tracking-wider">
                                            {t('chat.tool_chart')}
                                        </span>
                                        {isActive && (
                                            <div className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin ml-auto" />
                                        )}
                                    </div>
                                    {renderToolResult(resultMsg, isActive)}
                                </div>
                            );
                        }
                        return;
                    }

                    // Legacy chart tool from sessions created before the Pi runtime.
                    if (toolName === 'render_chart') {
                        try {
                            const chartConfig = JSON.parse(args.option);
                            const chartTitle = args.title;
                            elements.push(
                                <div
                                    key={key}
                                    className="border rounded-lg p-4 bg-background/50 my-2"
                                >
                                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                        {chartTitle}
                                        <div className="ml-auto flex gap-1">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-6 w-6"
                                                title={t('chat.download_image')}
                                                onClick={() => handleDownloadChart(tc.id, chartTitle)}
                                            >
                                                <ImageDown className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-6 w-6"
                                                title={t('chat.export_excel')}
                                                onClick={() => openTablePreview(chartConfig, chartTitle)}
                                            >
                                                <FileSpreadsheet className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </h3>
                                    {args.explanation && (
                                        <div className="text-muted-foreground text-[11px] mb-4 leading-tight">
                                            {args.explanation}
                                        </div>
                                    )}
                                    <ChartRenderer
                                        ref={(el) => {
                                            if (el) chartRefs.current.set(tc.id, el);
                                        }}
                                        options={chartConfig}
                                    />
                                </div>
                            );
                        } catch {
                            // Ignore unparseable legacy chart payloads.
                        }
                        return;
                    }

                    // General tool display
                    elements.push(
                        <div
                            key={key}
                            className="bg-muted/30 rounded-md p-2 text-[11px] border border-border/50 font-mono"
                        >
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary/50" />
                                <span className="font-semibold uppercase tracking-wider">
                                    {toolName || 'tool'}
                                </span>
                                {isActive && !resultMsg && (
                                    <div className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin ml-auto" />
                                )}
                            </div>
                            <div className="opacity-70 whitespace-pre-wrap break-all bg-background/30 p-1 rounded">
                                {tc.function.arguments}
                            </div>
                            {resultMsg && (
                                <div className="mt-2 pt-2 border-t border-border/30 text-muted-foreground/80 overflow-x-auto max-h-[200px]">
                                    {resultMsg.content.length > 500
                                        ? resultMsg.content.slice(0, 500) + '...'
                                        : resultMsg.content}
                                </div>
                            )}
                        </div>
                    );
                });
            }
        });

        if (isActive && groupMessages.length > 0) {
            const lastMsg = groupMessages[groupMessages.length - 1];
            const lastAssistant = [...groupMessages]
                .reverse()
                .find((message) => message.role === 'assistant');
            const isWaiting =
                !lastMsg.content ||
                (lastAssistant?.tool_calls &&
                    lastAssistant.tool_calls.some(
                        (tc) => !messages.find((m) => m.role === 'tool' && m.tool_call_id === tc.id)
                    ));
            if (isWaiting) {
                elements.push(
                    <div
                        key="active-thinking"
                        className="flex items-center gap-2 text-xs text-muted-foreground italic pl-1"
                    >
                        <div className="flex gap-1">
                            <div
                                className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce"
                                style={{ animationDelay: '0ms' }}
                            />
                            <div
                                className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce"
                                style={{ animationDelay: '150ms' }}
                            />
                            <div
                                className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce"
                                style={{ animationDelay: '300ms' }}
                            />
                        </div>
                        {t('chat.thinking')}
                    </div>
                );
            }
        }

        return elements;
    }

    return (
        <>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {exportError && (
                    <div className="max-w-4xl mx-auto w-full flex items-center gap-2 p-2 text-xs bg-destructive/10 text-destructive rounded border border-destructive/20">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1">{exportError}</span>
                        <button
                            className="text-[10px] underline"
                            onClick={() => setExportError(null)}
                        >
                            {t('chat.dismiss')}
                        </button>
                    </div>
                )}
                {pinNotice && (
                    <div className="max-w-4xl mx-auto w-full flex items-center gap-2 p-2 text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1">{pinNotice}</span>
                        <button
                            className="text-[10px] underline"
                            onClick={() => setPinNotice(null)}
                        >
                            {t('chat.dismiss')}
                        </button>
                    </div>
                )}
                {renderedGroups.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4 opacity-50">
                        <Bot className="w-12 h-12" />
                        <p>{t('chat.no_messages')}</p>
                    </div>
                )}
                {renderedGroups}
            </div>
            <TablePreviewModal
                open={tablePreview.open}
                onClose={() => setTablePreview({ open: false, data: [], title: '' })}
                data={tablePreview.data}
                columns={tablePreview.columns}
                queryId={tablePreview.queryId}
                title={tablePreview.title}
            />
            <PinChartDialog
                open={!!pinTarget}
                chart={pinTarget}
                onOpenChange={(open) => {
                    if (!open) setPinTarget(null);
                }}
                onSubscribed={handleSubscribed}
            />
        </>
    );
}
