import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/components/ui/collapsible';
import { ChevronRight, Database, LineChart, Loader2, Braces } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/agent/core';

interface ThoughtChainProps {
    toolDetails: {
        toolCall: any;
        toolResult: ChatMessage | undefined;
    }[];
    isThinking?: boolean;
}

export function ThoughtChain({ toolDetails, isThinking }: ThoughtChainProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);

    if (toolDetails.length === 0) return null;

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={setIsOpen}
            className="w-full border rounded-lg bg-muted/30 my-2 overflow-hidden"
        >
            <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
                <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", isOpen && "rotate-90")} />
                <span>
                    {isThinking
                        ? t('chat.thinking_process')
                        : t('chat.thought_process_completed', { count: toolDetails.length })}
                </span>
                {isThinking && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
            </CollapsibleTrigger>

            <CollapsibleContent>
                <div className="flex flex-col gap-2 p-3 pt-0 border-t bg-black/5">
                    {toolDetails.map((step, idx) => {
                        const isQuery = step.toolCall.function.name === 'query_database';
                        const isChart = step.toolCall.function.name === 'render_chart';
                        const args = parseArgs(step.toolCall.function.arguments);

                        return (
                            <div key={step.toolCall.id || idx} className="text-xs space-y-1.5">
                                {/* Tool Invocation */}
                                <div className="flex items-start gap-2 text-foreground/80 font-medium">
                                    {isQuery && <Database className="w-3.5 h-3.5 mt-0.5 text-blue-500" />}
                                    {isChart && <LineChart className="w-3.5 h-3.5 mt-0.5 text-green-500" />}
                                    {!isQuery && !isChart && <Braces className="w-3.5 h-3.5 mt-0.5" />}

                                    <div className="flex-1 overflow-hidden">
                                        <div className="flex justify-between items-center">
                                            <span>{isQuery ? t('chat.tool_query') : isChart ? t('chat.tool_chart') : step.toolCall.function.name}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono opacity-50">{step.toolCall.id?.slice(-4)}</span>
                                        </div>

                                        {/* Arguments Preview */}
                                        <div className="mt-1 font-mono text-[10px] text-muted-foreground bg-background/50 p-1.5 rounded border overflow-x-auto whitespace-pre-wrap">
                                            {isQuery ? args.sql : isChart ? `Title: ${args.title}` : JSON.stringify(args, null, 2)}
                                        </div>
                                    </div>
                                </div>

                                {/* Tool Result */}
                                {step.toolResult ? (
                                    <div className="ml-5 pl-2 border-l-2 border-muted-foreground/20">
                                        <div className="font-mono text-[10px] text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap opacity-80 hover:opacity-100 transition-opacity">
                                            {truncateResult(step.toolResult.content)}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="ml-5 text-[10px] text-muted-foreground italic flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" /> {t('chat.executing')}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function parseArgs(jsonHash: string) {
    try {
        return JSON.parse(jsonHash);
    } catch {
        return {};
    }
}

function truncateResult(content: string, maxLength = 500) {
    if (!content) return "No content";
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + `\n... (${content.length - maxLength} more characters)`;
}
