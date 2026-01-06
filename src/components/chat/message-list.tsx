import React, { useRef, useState } from 'react';
import { Bot, User, FileSpreadsheet, ImageDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChartRenderer } from './chart-renderer';
import { TablePreviewModal } from './table-preview-modal';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from '@/lib/agent/core';
import { useTranslation } from 'react-i18next';
import type ReactECharts from 'echarts-for-react';

interface MessageListProps {
    messages: ChatMessage[];
    isThinking?: boolean;
}

export function MessageList({ messages, isThinking }: MessageListProps) {
    const { t } = useTranslation();
    const chartRefs = useRef<Map<string, ReactECharts>>(new Map());
    const [tablePreview, setTablePreview] = useState<{
        open: boolean;
        data: any[];
        title: string;
    }>({ open: false, data: [], title: '' });


    // 从图表配置中提取表格数据
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
            console.error("Extract table data failed", e);
        }
        return [];
    };

    // 打开表格预览
    const openTablePreview = (option: any, title: string) => {
        const data = extractTableData(option);
        if (data.length > 0) {
            setTablePreview({ open: true, data, title });
        } else {
            console.warn("Could not extract tabular data from chart option");
        }
    };

    // 下载图表为图片
    const handleDownloadChart = (chartId: string, title: string) => {
        const chartInstance = chartRefs.current.get(chartId);
        if (chartInstance) {
            const echartsInstance = chartInstance.getEchartsInstance();
            const url = echartsInstance.getDataURL({
                type: 'png',
                pixelRatio: 2,
                backgroundColor: '#fff'
            });
            const link = document.createElement('a');
            link.download = `${title || 'chart'}.png`;
            link.href = url;
            link.click();
        }
    };

    // Group messages for rendering
    const renderedGroups: React.JSX.Element[] = [];
    const visibleMessages = messages.filter(m => m.role !== 'system');

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

    function renderMergedContent(groupMessages: ChatMessage[], isActive: boolean) {
        const elements: React.JSX.Element[] = [];

        groupMessages.forEach((msg, idx) => {
            // 1. Text Content - Only render if role is assistant
            // Tool messages are handled within their corresponding assistant tool call block
            if (msg.role === 'assistant' && msg.content) {
                let displayContent = msg.content;
                // Strip <think> tags for cleaner display
                displayContent = displayContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                // If there's still a partial <think> (streaming)
                if (displayContent.includes('<think>')) {
                    displayContent = displayContent.split('<think>')[0].trim();
                }

                if (displayContent) {
                    elements.push(
                        <div key={`${msg.id}-text-${idx}`} className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {displayContent}
                            </ReactMarkdown>
                        </div>
                    );
                }
            }

            // 2. Tool Calls & Results
            if (msg.tool_calls) {
                msg.tool_calls.forEach((tc: any, tcIdx: number) => {
                    const isChartTool = tc.function.name === 'render_chart';
                    const isQueryTool = tc.function.name === 'query_database';

                    // Find corresponding result
                    const resultMsg = messages.find(m => m.role === 'tool' && m.tool_call_id === tc.id);

                    if (isChartTool) {
                        try {
                            const args = JSON.parse(tc.function.arguments);
                            const chartConfig = JSON.parse(args.option);
                            const chartTitle = args.title;
                            const chartExplanation = args.explanation;

                            elements.push(
                                <div key={`${tc.id}-chart-${tcIdx}`} className="border rounded-lg p-4 bg-background/50 my-2">
                                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                        {chartTitle}
                                        <div className="ml-auto flex gap-1">
                                            <Button size="icon" variant="ghost" className="h-6 w-6" title={t('chat.download_image')} onClick={() => handleDownloadChart(tc.id, chartTitle)}>
                                                <ImageDown className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-6 w-6" title={t('chat.export_excel')} onClick={() => openTablePreview(chartConfig, chartTitle)}>
                                                <FileSpreadsheet className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </h3>
                                    <div className="text-muted-foreground text-[11px] mb-4 leading-tight">{chartExplanation}</div>
                                    <ChartRenderer
                                        ref={(el) => {
                                            if (el) chartRefs.current.set(tc.id, el);
                                        }}
                                        options={chartConfig}
                                    />
                                </div>
                            );
                        } catch (e) { /* ignore parse errors */ }
                    } else if (isQueryTool) {
                        // SQL tool execution display with Collapsible support
                        elements.push(
                            <div key={`${tc.id}-tool-${tcIdx}`} className="bg-muted/30 rounded-md overflow-hidden text-[11px] border border-border/50 font-mono">
                                <details className="group">
                                    <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors list-none">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                                        <span className="font-semibold uppercase tracking-wider text-muted-foreground">{t('chat.tool_query')}</span>
                                        <span className="text-[10px] opacity-40 ml-1">{tc.id?.slice(-4)}</span>
                                        {isActive && !resultMsg && <div className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin ml-2" />}
                                        <div className="ml-auto transition-transform group-open:rotate-90">
                                            <svg className="w-3 h-3 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="9 5l7 7-7 7" />
                                            </svg>
                                        </div>
                                    </summary>
                                    <div className="px-2 pb-2">
                                        <div className="opacity-70 whitespace-pre-wrap break-all bg-background/50 p-2 rounded border border-border/30">
                                            {JSON.parse(tc.function.arguments).sql}
                                        </div>
                                    </div>
                                </details>
                                {resultMsg && (
                                    <div className="px-2 py-2 border-t border-border/30 text-muted-foreground/80 overflow-x-auto max-h-[200px]">
                                        {resultMsg.content.length > 500 ? resultMsg.content.slice(0, 500) + '...' : resultMsg.content}
                                    </div>
                                )}
                            </div>
                        );
                    } else {
                        // General tool display
                        elements.push(
                            <div key={`${tc.id}-tool-${tcIdx}`} className="bg-muted/30 rounded-md p-2 text-[11px] border border-border/50 font-mono">
                                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50" />
                                    <span className="font-semibold uppercase tracking-wider">{tc.function.name}</span>
                                    {isActive && !resultMsg && <div className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin ml-auto" />}
                                </div>
                                <div className="opacity-70 whitespace-pre-wrap break-all bg-background/30 p-1 rounded">
                                    {tc.function.arguments}
                                </div>
                                {resultMsg && (
                                    <div className="mt-2 pt-2 border-t border-border/30 text-muted-foreground/80 overflow-x-auto max-h-[200px]">
                                        {resultMsg.content.length > 500 ? resultMsg.content.slice(0, 500) + '...' : resultMsg.content}
                                    </div>
                                )}
                            </div>
                        );
                    }
                });
            }
        });

        // Add thinking loader at the very end if active
        if (isActive && groupMessages.length > 0) {
            const lastMsg = groupMessages[groupMessages.length - 1];
            // Only show if the last message is either contentless or waiting for tool results
            const isWaiting = !lastMsg.content || (lastMsg.tool_calls && lastMsg.tool_calls.some(tc => !messages.find(m => m.role === 'tool' && m.tool_call_id === tc.id)));
            if (isWaiting) {
                elements.push(
                    <div key="active-thinking" className="flex items-center gap-2 text-xs text-muted-foreground italic pl-1">
                        <div className="flex gap-1">
                            <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-1 h-1 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
                title={tablePreview.title}
            />
        </>
    );
}
