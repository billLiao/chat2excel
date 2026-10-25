/**
 * Pi-powered agent runtime running in the Electron main process.
 *
 * The renderer never sees an API key or a Node-enabled window: it sends a
 * prompt and receives message snapshots. Tools execute in main, results become
 * query artifacts, and charts are derived from those artifacts.
 */

import { randomUUID } from 'node:crypto';
import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core';
import {
    createModels,
    createProvider,
    type AssistantMessage,
    type Message,
    type Model,
    type ToolCall,
    type UserMessage,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { store } from '../store';
import { sessionManager } from '../session';
import { getModels } from '../settings';
import { buildSystemPrompt } from './prompt';
import { createDefaultAgentTools } from './tools';
import { slimMessageForPersist } from './slim';
import type { ChartDataset } from './chart';
import { mcpAgentTools } from '../agents/mcp';
import type {
    AgentQuestionRecord,
    AskUserAnswer,
    AskUserRequest,
    ChatMessage,
    QueryPreviewData,
} from '../../src/lib/agent/message';

export interface AgentRunOptions {
    sessionId: string;
    input: string;
    contextTables?: string[];
    modelName?: string;
}

export interface AgentEventPayload {
    runId: string;
    sessionId: string;
    type: 'start' | 'update' | 'tool_start' | 'tool_end' | 'end' | 'error';
    messages: ChatMessage[];
    error?: string;
    aborted?: boolean;
    toolCallId?: string;
    toolName?: string;
    /** Tool arguments, forwarded on tool_start (e.g. the ask_user question). */
    toolArgs?: unknown;
}

export type AgentEventSender = (event: AgentEventPayload) => void;

interface RunState {
    runId: string;
    sessionId: string;
    agent: Agent;
    messages: ChatMessage[];
    currentAssistantId: string | null;
    assistantCounter: number;
    queryIds: Set<string>;
    aborted: boolean;
    ended: boolean;
    updateTimer: NodeJS.Timeout | null;
    lastSentAt: number;
    send: AgentEventSender;
}

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
}

const activeRuns = new Map<string, RunState>();

// --- ask_user plumbing -------------------------------------------------------
// The tool call blocks on a promise stored here; the renderer resolves it via
// the agent:answer-question IPC channel. One pending question per tool call.

interface PendingQuestion {
    sessionId: string;
    timer: NodeJS.Timeout;
    resolve: (answer: AskUserAnswer) => void;
}

const pendingQuestions = new Map<string, PendingQuestion>();
const QUESTION_TIMEOUT_MS = 5 * 60_000;

export function answerAgentQuestion(
    toolCallId: string,
    answer: AskUserAnswer
): boolean {
    const pending = pendingQuestions.get(toolCallId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pendingQuestions.delete(toolCallId);
    pending.resolve(answer);
    return true;
}

function resolveSessionPendingQuestions(sessionId: string, answer: AskUserAnswer): void {
    for (const [toolCallId, pending] of Array.from(pendingQuestions.entries())) {
        if (pending.sessionId !== sessionId) continue;
        clearTimeout(pending.timer);
        pendingQuestions.delete(toolCallId);
        pending.resolve(answer);
    }
}

function askAgentQuestion(
    state: RunState,
    toolCallId: string,
    _request: AskUserRequest
): Promise<AskUserAnswer> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            if (pendingQuestions.delete(toolCallId)) {
                resolve({ timeout: true });
            }
        }, QUESTION_TIMEOUT_MS);
        pendingQuestions.set(toolCallId, {
            sessionId: state.sessionId,
            timer,
            resolve,
        });
    });
}
// -----------------------------------------------------------------------------
const EMPTY_USAGE = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function getActiveRunForSession(sessionId: string): string | null {
    for (const state of activeRuns.values()) {
        if (state.sessionId === sessionId) return state.runId;
    }
    return null;
}

export function abortAgentRun(runId: string): boolean {
    const state = activeRuns.get(runId);
    if (!state) return false;
    state.aborted = true;
    state.agent.abort();
    // Unblock any ask_user tool call so the run can settle.
    resolveSessionPendingQuestions(state.sessionId, { canceled: true });
    return true;
}

export async function startAgentRun(
    options: AgentRunOptions,
    send: AgentEventSender
): Promise<{ runId: string }> {
    const input = options.input?.trim();
    if (!input) throw new Error('The message is empty.');
    if (!options.sessionId) throw new Error('A session is required.');

    const session = sessionManager.getSessions().find((item) => item.id === options.sessionId);
    if (!session) throw new Error('The chat session no longer exists.');

    const existing = getActiveRunForSession(options.sessionId);
    if (existing) {
        throw new Error('This chat is still generating a response. Stop it before sending another message.');
    }

    const config = resolveModelConfig(options.modelName);
    const modelConfig = createModel(config);
    const systemPrompt = await buildSystemPrompt({
        contextTables: options.contextTables,
        customPrompt: store.get('systemPrompt'),
    });

    const historyMessages: ChatMessage[] = Array.isArray(session.messages) ? session.messages : [];
    const userMessage: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        content: input,
        timestamp: Date.now(),
    };

    const runId = randomUUID();
    const state = {
        runId,
        sessionId: options.sessionId,
        queryIds: new Set<string>(),
        aborted: false,
        ended: false,
        updateTimer: null,
        lastSentAt: 0,
        messages: [...historyMessages, userMessage],
    } as RunState;

    const tools = await createTools(state, options.contextTables);
    const agent = new Agent({
        sessionId: options.sessionId,
        initialState: {
            systemPrompt,
            model: modelConfig.model,
            tools,
            messages: toPiHistory(historyMessages, config.modelId),
        },
        streamFn: modelConfig.models.streamSimple.bind(modelConfig.models),
    });

    state.agent = agent;
    state.send = send;
    activeRuns.set(runId, state);

    // Persist the user's message immediately so a crash cannot lose it.
    persist(state);
    sendEvent(state, 'start', true);

    void executeRun(state, input);
    return { runId };
}

async function executeRun(state: RunState, input: string): Promise<void> {
    state.agent.subscribe((event) => {
        try {
            handleAgentEvent(state, event);
        } catch (error) {
            console.error('[Agent] Failed to handle event:', error);
        }
    });

    try {
        await state.agent.prompt(input);
        await state.agent.waitForIdle();
        finish(state);
    } catch (error: any) {
        if (state.aborted) {
            finish(state);
            return;
        }
        const message = error?.message || String(error);
        state.messages.push({
            id: randomUUID(),
            role: 'assistant',
            content: `抱歉，分析过程中出错：${message}`,
            timestamp: Date.now(),
            error: true,
        });
        finish(state, message);
    }
}

function handleAgentEvent(state: RunState, event: AgentEvent): void {
    switch (event.type) {
        case 'message_start': {
            if (event.message.role !== 'assistant') return;
            state.assistantCounter += 1;
            const id = `${state.runId}_assistant_${state.assistantCounter}`;
            state.currentAssistantId = id;
            state.messages.push({
                id,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
            });
            scheduleUpdate(state);
            return;
        }
        case 'message_update': {
            if (event.message.role !== 'assistant') return;
            const assistant = getCurrentAssistantMessage(state);
            if (!assistant) return;
            rebuildAssistantMessage(assistant, event.message);
            scheduleUpdate(state);
            return;
        }
        case 'message_end': {
            if (event.message.role !== 'assistant') return;
            const assistant = getCurrentAssistantMessage(state);
            if (assistant) {
                rebuildAssistantMessage(assistant, event.message);
            }
            state.currentAssistantId = null;
            persist(state);
            scheduleUpdate(state);
            return;
        }
        case 'tool_execution_start': {
            sendEvent(state, 'tool_start', true, {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                toolArgs: event.args,
            });
            return;
        }
        case 'tool_execution_end': {
            const toolMessage = buildToolMessage(event);
            state.messages.push(toolMessage);
            sendEvent(state, 'tool_end', true, {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
            });
            persist(state);
            return;
        }
        case 'agent_end': {
            flushUpdate(state);
            return;
        }
        default:
            return;
    }
}

function getCurrentAssistantMessage(state: RunState): ChatMessage | null {
    if (!state.currentAssistantId) return null;
    return state.messages.find((message) => message.id === state.currentAssistantId) || null;
}

function rebuildAssistantMessage(target: ChatMessage, source: AssistantMessage): void {
    const blocks = Array.isArray(source.content) ? source.content : [];
    const text = blocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('');
    const thinking = blocks
        .filter((block): block is { type: 'thinking'; thinking: string } => block.type === 'thinking')
        .map((block) => block.thinking)
        .join('');

    target.content = text;
    target.thinking = thinking || undefined;

    const toolCalls = blocks.filter((block): block is ToolCall => block.type === 'toolCall');
    if (toolCalls.length > 0) {
        target.tool_calls = toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
            },
        }));
    } else {
        delete target.tool_calls;
    }
}

function buildToolMessage(
    event: Extract<AgentEvent, { type: 'tool_execution_end' }>
): ChatMessage {
    const result = event.result as
        | {
              content?: Array<{ type: string; text?: string }>;
              details?: any;
          }
        | undefined;
    const content = (result?.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text || '')
        .join('\n')
        .trim();
    const details = result?.details;

    const message: ChatMessage = {
        id: randomUUID(),
        role: 'tool',
        tool_call_id: event.toolCallId,
        name: event.toolName,
        content: content || (event.isError ? 'Tool execution failed.' : ''),
        timestamp: Date.now(),
        error: event.isError || undefined,
    };

    if (details?.kind === 'query' && details.query) {
        message.query = details.query as QueryPreviewData;
    }
    if (details?.kind === 'ask_user' && details.question) {
        message.question = {
            ...(details.question as AskUserRequest),
            answer: (details.answer as AskUserAnswer | undefined) || undefined,
        } satisfies AgentQuestionRecord;
    }
    if (details?.kind === 'chart' && details.chart) {
        const chart = { ...(details.chart as ChartDataset) };
        if (details.pinned?.chartId) {
            chart.chartId = details.pinned.chartId;
        }
        message.chart = chart;
    }

    return message;
}

function scheduleUpdate(state: RunState): void {
    if (state.ended) return;
    const now = Date.now();
    const elapsed = now - state.lastSentAt;
    if (elapsed >= 60) {
        state.lastSentAt = now;
        sendEvent(state, 'update', false);
        return;
    }
    if (state.updateTimer) return;
    state.updateTimer = setTimeout(() => {
        state.updateTimer = null;
        if (state.ended) return;
        state.lastSentAt = Date.now();
        sendEvent(state, 'update', false);
    }, 60 - elapsed);
}

function flushUpdate(state: RunState): void {
    if (state.updateTimer) {
        clearTimeout(state.updateTimer);
        state.updateTimer = null;
    }
    if (!state.ended) {
        state.lastSentAt = Date.now();
        sendEvent(state, 'update', false);
    }
}

function sendEvent(
    state: RunState,
    type: AgentEventPayload['type'],
    force: boolean,
    extra: Partial<AgentEventPayload> = {}
): void {
    if (state.ended && type !== 'end' && type !== 'error') return;
    if (!force) {
        // Snapshot messages are serialized by Electron; the throttle above
        // keeps streaming text from flooding the renderer.
    }
    try {
        state.send({
            runId: state.runId,
            sessionId: state.sessionId,
            type,
            messages: state.messages.map((message) => ({ ...message })),
            ...extra,
        });
    } catch (error) {
        console.error('[Agent] Failed to send event:', error);
    }
}

function finish(state: RunState, error?: string): void {
    if (state.ended) return;
    state.ended = true;
    if (state.updateTimer) {
        clearTimeout(state.updateTimer);
        state.updateTimer = null;
    }

    // Drop an empty assistant placeholder left behind by an abort before the
    // first token arrived.
    state.messages = state.messages.filter(
        (message) =>
            !(
                message.role === 'assistant' &&
                !message.content &&
                !message.thinking &&
                (!message.tool_calls || message.tool_calls.length === 0) &&
                !message.chart &&
                !message.query
            )
    );

    persist(state);
    const aborted = state.aborted;
    sendEvent(state, error ? 'error' : 'end', true, {
        error,
        aborted,
    });
    activeRuns.delete(state.runId);
}

function persist(state: RunState): void {
    try {
        sessionManager.updateSessionMessages(
            state.sessionId,
            state.messages.map(slimMessageForPersist)
        );
    } catch (error) {
        console.error('[Agent] Failed to persist session:', error);
    }
}

function resolveModelConfig(modelName?: string): ModelConfig {
    const models = getModels() as ModelConfig[];
    const activeName = modelName || store.get('activeModelId');
    const config =
        models.find((model) => model.name === activeName) ||
        (models.length === 1 ? models[0] : undefined);

    if (!config) {
        throw new Error('请先在设置中配置并选择一个模型。');
    }
    if (!config.apiKey?.trim()) {
        throw new Error(`模型“${config.name}”缺少 API Key，请到设置中填写。`);
    }
    if (!config.baseUrl?.trim()) {
        throw new Error(`模型“${config.name}”缺少 Base URL，请到设置中填写。`);
    }
    if (!config.modelId?.trim()) {
        throw new Error(`模型“${config.name}”缺少 Model ID，请到设置中填写。`);
    }

    return {
        ...config,
        baseUrl: config.baseUrl.replace(/\/+$/, ''),
    };
}

function createModel(config: ModelConfig): {
    model: Model<'openai-completions'>;
    models: ReturnType<typeof createModels>;
} {
    const model: Model<'openai-completions'> = {
        id: config.modelId,
        name: config.name || config.modelId,
        api: 'openai-completions',
        provider: 'chat2excel',
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
    };

    const provider = createProvider({
        id: 'chat2excel',
        name: 'Chat2Excel',
        baseUrl: config.baseUrl,
        auth: {
            apiKey: {
                name: 'Chat2Excel API key',
                resolve: async () => ({ auth: { apiKey: config.apiKey } }),
            },
        },
        models: [model],
        api: openAICompletionsApi(),
    });

    const models = createModels();
    models.setProvider(provider);
    return { model, models };
}

function toPiHistory(messages: ChatMessage[], modelId: string): Message[] {
    return messages
        .filter(
            (message) =>
                (message.role === 'user' || message.role === 'assistant') &&
                message.content.trim() &&
                !message.error
        )
        .slice(-12)
        .map((message): Message => {
            if (message.role === 'user') {
                return {
                    role: 'user',
                    content: message.content,
                    timestamp: message.timestamp || Date.now(),
                } satisfies UserMessage;
            }
            return {
                role: 'assistant',
                content: [{ type: 'text', text: message.content }],
                api: 'openai-completions',
                provider: 'chat2excel',
                model: modelId,
                usage: EMPTY_USAGE,
                stopReason: 'stop',
                timestamp: message.timestamp || Date.now(),
            } satisfies AssistantMessage;
        });
}

async function createTools(state: RunState, contextTables?: string[]): Promise<AgentTool<any, any>[]> {
    const defaultTools = await createDefaultAgentTools({
        contextTables: contextTables && contextTables.length > 0 ? contextTables : undefined,
        queryIds: state.queryIds,
        sessionId: state.sessionId,
        askUser: (toolCallId, request) => askAgentQuestion(state, toolCallId, request),
    });
    const mcpTools = await mcpAgentTools();
    return [...defaultTools, ...mcpTools];
}
