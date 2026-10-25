import { useState, useEffect, useRef } from 'react';
import { MessageList } from './message-list';
import { ChatInput } from './chat-input';
import type { AskUserRequest, ChatMessage } from '@/lib/agent/message';
import { Button } from '@/components/ui/button';
import { Plus, MessageSquare, Trash2, Edit2, ShieldCheck, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface Session {
    id: string;
    title: string;
    messages: ChatMessage[];
    timestamp?: number;
    updatedAt?: number;
}

function safeParseJson(raw: string): Record<string, any> | null {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function ChatLayout() {
    const { t } = useTranslation();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [configError, setConfigError] = useState<string | null>(null);
    const [pendingQuestions, setPendingQuestions] = useState<Record<string, AskUserRequest>>({});

    const messagesRef = useRef<ChatMessage[]>([]);
    const currentSessionIdRef = useRef<string | null>(null);
    const activeRunsRef = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    useEffect(() => {
        loadSessions();
    }, []);

    useEffect(() => {
        const unsubscribe = window.api.agent.onEvent((event) => {
            if (event.messages) {
                setSessions((prev) =>
                    prev.map((session) =>
                        session.id === event.sessionId
                            ? { ...session, messages: event.messages }
                            : session
                    )
                );
                if (event.sessionId === currentSessionIdRef.current) {
                    setMessages(event.messages);
                    messagesRef.current = event.messages;
                }
            }

            // ask_user: the question card becomes interactive as soon as the
            // tool starts, and freezes into a persisted record on tool_end.
            if (event.type === 'tool_start' && event.toolName === 'ask_user') {
                const raw =
                    typeof event.toolArgs === 'string'
                        ? safeParseJson(event.toolArgs)
                        : event.toolArgs;
                if (event.toolCallId) {
                    setPendingQuestions((prev) => ({
                        ...prev,
                        [event.toolCallId!]: {
                            question: typeof raw?.question === 'string' ? raw.question : '',
                            options: Array.isArray(raw?.options) ? raw.options : undefined,
                            multiple: raw?.multiple === true,
                            allowFreeText: raw?.allowFreeText !== false,
                        },
                    }));
                }
            }
            if (
                (event.type === 'tool_end' && event.toolName === 'ask_user' && event.toolCallId) ||
                event.type === 'end' ||
                event.type === 'error'
            ) {
                setPendingQuestions((prev) => {
                    if (event.type !== 'tool_end') return {};
                    const next = { ...prev };
                    delete next[event.toolCallId!];
                    return next;
                });
            }

            if (event.type === 'end' || event.type === 'error') {
                activeRunsRef.current.delete(event.sessionId);
                if (event.sessionId === currentSessionIdRef.current) {
                    setIsThinking(false);
                }
                if (event.error) {
                    setConfigError(event.error);
                }
            }
        });
        return unsubscribe;
    }, []);

    const loadSessions = async () => {
        const list = await window.api.sessions.list();
        // Newest first; older records only have `timestamp`.
        const sorted = [...list].sort(
            (a, b) =>
                (b.updatedAt ?? b.timestamp ?? 0) - (a.updatedAt ?? a.timestamp ?? 0)
        );
        setSessions(sorted);
        if (sorted.length > 0) {
            const current = sorted.find(s => s.id === currentSessionId) || sorted[0];
            setCurrentSessionId(current.id);
            setMessages(current.messages || []);
            messagesRef.current = current.messages || [];
            setIsThinking(activeRunsRef.current.has(current.id));
        } else {
            handleNewChat();
        }
    };

    const handleNewChat = async () => {
        const newSession = await window.api.sessions.create(t('chat.new_chat'));
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        setMessages([]);
        messagesRef.current = [];
        setIsThinking(activeRunsRef.current.has(newSession.id));
    };

    const handleSelectSession = (session: Session) => {
        setCurrentSessionId(session.id);
        setMessages(session.messages || []);
        messagesRef.current = session.messages || [];
        setIsThinking(activeRunsRef.current.has(session.id));
        setConfigError(null);
    };

    const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const ok = await window.api.sessions.delete(id);
        if (ok) {
            setSessions(prev => {
                const updated = prev.filter(s => s.id !== id);
                if (currentSessionId === id) {
                    if (updated.length > 0) {
                        handleSelectSession(updated[0]);
                    } else {
                        handleNewChat();
                    }
                }
                return updated;
            });
        }
    };

    const handleRename = async (id: string) => {
        if (!editValue.trim()) return setEditingId(null);
        const ok = await window.api.sessions.rename(id, editValue);
        if (ok) {
            setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editValue } : s));
            setEditingId(null);
        }
    };

    const handleSendMessage = async (text: string, contextTables: string[], modelConfig: any) => {
        if (!text.trim() || !currentSessionId) return;
        if (isThinking) return;

        setConfigError(null);

        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: text,
            timestamp: Date.now()
        };
        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        messagesRef.current = newMessages;

        // Auto-rename session if it's the first message
        if (messages.length === 0) {
            const newTitle = text.trim().slice(0, 30);
            await window.api.sessions.rename(currentSessionId, newTitle);
            setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, title: newTitle } : s));
        }

        setIsThinking(true);
        try {
            const response = await window.api.agent.run({
                sessionId: currentSessionId,
                input: text,
                contextTables,
                modelName: modelConfig?.name,
            });

            if (response?.error || !response?.runId) {
                throw new Error(response?.error || t('chat.config_error'));
            }

            activeRunsRef.current.set(currentSessionId, response.runId);
        } catch (error: any) {
            console.error("Agent error:", error);
            setConfigError(error?.message || String(error));
            setIsThinking(false);
            activeRunsRef.current.delete(currentSessionId);
        }
    };

    const handleStop = async () => {
        if (!currentSessionId) return;
        const runId = activeRunsRef.current.get(currentSessionId);
        if (!runId) return;
        await window.api.agent.abort(runId);
    };



    return (
        <div className="flex h-full overflow-hidden bg-background">
            <aside className="w-64 border-r bg-muted/20 flex flex-col shrink-0">
                <div className="p-4 border-b bg-background/50 backdrop-blur-sm">
                    <Button
                        onClick={handleNewChat}
                        className="w-full justify-start gap-2 shadow-sm rounded-lg font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform"
                    >
                        <Plus className="w-4 h-4" />
                        {t('chat.new_chat')}
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    <div className="space-y-1">
                        {sessions.map((session) => (
                            <div
                                key={session.id}
                                onClick={() => handleSelectSession(session)}
                                className={cn(
                                    "group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all hover:bg-muted select-none relative",
                                    currentSessionId === session.id ? "bg-muted text-foreground ring-1 ring-border shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />

                                {editingId === session.id ? (
                                    <input
                                        autoFocus
                                        className="bg-transparent border-none outline-none text-sm w-full font-medium"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={() => handleRename(session.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleRename(session.id);
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                    />
                                ) : (
                                    <span className="text-sm truncate pr-10 font-medium">{session.title}</span>
                                )}

                                <div className={cn(
                                    "absolute right-2 flex gap-1 transition-opacity",
                                    currentSessionId === session.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                )}>
                                    {editingId !== session.id && (
                                        <>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingId(session.id);
                                                    setEditValue(session.title);
                                                }}
                                                className="p-1 hover:bg-background rounded-md transition-colors"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteSession(e, session.id)}
                                                className="p-1 hover:bg-background text-destructive rounded-md transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 border-t bg-muted/10">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                        <ShieldCheck className="w-3 h-3" />
                        {t('chat.local_storage')}
                    </div>
                </div>
            </aside>

            <main className="flex-1 flex flex-col relative min-w-0 bg-background/50">


                <div className="flex-1 overflow-hidden flex flex-col">
                    <MessageList
                        messages={messages}
                        isThinking={isThinking}
                        pendingQuestions={pendingQuestions}
                    />
                </div>

                <div className="p-4 max-w-4xl mx-auto w-full space-y-2">
                    {configError && (
                        <div className="flex items-center gap-2 p-3 text-sm bg-destructive/10 text-destructive rounded-lg border border-destructive/20 mb-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{configError}</span>
                        </div>
                    )}
                    <ChatInput
                        onSend={handleSendMessage}
                        disabled={isThinking}
                        isThinking={isThinking}
                        onStop={handleStop}
                    />
                </div>
            </main>
        </div>
    );
}
