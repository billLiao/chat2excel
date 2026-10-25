/**
 * Clarification-question card for the ask_user agent tool.
 *
 * Interactive while the tool call is pending (the run pauses until the user
 * answers); rendered read-only from persisted history afterwards.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp, Clock, MessageCircleQuestion, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
    AgentQuestionRecord,
    AskUserOption,
    AskUserRequest,
} from '@/lib/agent/message';

interface QuestionCardProps {
    request: AskUserRequest;
    /** Present while the question is waiting for an answer. */
    toolCallId?: string;
    /** Persisted record (question + answer) for history rendering. */
    record?: AgentQuestionRecord;
    onAnswered?: () => void;
}

/** Tool arguments come straight from the model; be forgiving about shapes. */
export function parseAskUserRequest(raw: Record<string, any>): AskUserRequest {
    const options = Array.isArray(raw?.options)
        ? raw.options
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
              .filter((option): option is AskUserOption => option !== null)
        : undefined;
    return {
        question: typeof raw?.question === 'string' ? raw.question : '',
        options: options && options.length > 0 ? options : undefined,
        multiple: raw?.multiple === true,
        allowFreeText: raw?.allowFreeText !== false,
    };
}

export function QuestionCard({ request, toolCallId, record, onAnswered }: QuestionCardProps) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const interactive = Boolean(toolCallId) && !record?.answer;
    const answered = record?.answer;
    const options = useMemo(() => request.options || [], [request.options]);

    const toggle = (label: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (request.multiple) {
                if (next.has(label)) next.delete(label);
                else next.add(label);
            } else {
                next.clear();
                next.add(label);
            }
            return next;
        });
    };

    const submit = async () => {
        if (!toolCallId || submitting) return;
        if (selected.size === 0 && !text.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await window.api.agent.answerQuestion({
                toolCallId,
                selected: Array.from(selected),
                text: text.trim() || undefined,
            });
            if (!result.success) {
                throw new Error(result.error || t('question.failed'));
            }
            onAnswered?.();
        } catch (err: any) {
            setError(err?.message || t('question.failed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 my-1">
            <div className="flex items-center gap-2 mb-2">
                <MessageCircleQuestion className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-[11px] font-semibold">
                    {t('question.title')}
                </span>
                {answered?.timeout && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                        <Clock className="w-3 h-3" />
                        {t('question.timeout')}
                    </span>
                )}
                {answered?.canceled && (
                    <span className="text-[10px] text-muted-foreground">
                        {t('question.canceled')}
                    </span>
                )}
            </div>

            <div className="text-sm whitespace-pre-wrap leading-relaxed mb-2.5">
                {request.question || (answered ? '' : t('question.pending'))}
            </div>

            {options.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-2.5">
                    {options.map((option) => {
                        const isAnswered = answered?.selected?.includes(option.label);
                        const isSelected = selected.has(option.label);
                        const showActive = interactive ? isSelected : isAnswered;
                        return (
                            <button
                                key={option.label}
                                type="button"
                                disabled={!interactive || submitting}
                                onClick={() => toggle(option.label)}
                                className={cn(
                                    'text-left rounded-lg border px-2.5 py-1.5 transition-colors',
                                    showActive
                                        ? 'border-primary bg-primary/10'
                                        : 'hover:bg-muted/60',
                                    !interactive && !showActive && 'opacity-70'
                                )}
                            >
                                <div className="text-xs font-medium">{option.label}</div>
                                {option.description && (
                                    <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                                        {option.description}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {interactive && (
                <div className="flex items-center gap-2">
                    <Input
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') void submit();
                        }}
                        placeholder={t('question.placeholder')}
                        className="h-8 text-xs"
                    />
                    <Button
                        size="sm"
                        className="h-8 gap-1 px-3 text-xs shrink-0"
                        onClick={() => void submit()}
                        disabled={submitting || (selected.size === 0 && !text.trim())}
                    >
                        <Send className="w-3 h-3" />
                        {t('question.send')}
                    </Button>
                </div>
            )}

            {answered && !answered.timeout && !answered.canceled && (
                <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <CircleHelp className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>
                        {t('question.answer_label')}
                        {answered.selected?.length ? ` ${answered.selected.join('、')}` : ''}
                        {answered.selected?.length && answered.text ? '；' : ''}
                        {answered.text || ''}
                    </span>
                </div>
            )}

            {interactive && error && (
                <div className="mt-1.5 text-[11px] text-destructive break-all">{error}</div>
            )}
        </div>
    );
}
