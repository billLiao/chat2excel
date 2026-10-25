/**
 * Shared chat message shapes used by both the Electron main process and the
 * renderer. Keep this file free of runtime dependencies so it can be imported
 * as a type from either side.
 */

export const DEFAULT_SYSTEM_PROMPT = 'You are a data analysis assistant.';

export interface QueryColumnData {
    name: string;
    type: string;
}

export interface QueryPreviewData {
    queryId: string;
    sql: string;
    columns: QueryColumnData[];
    rows: Record<string, unknown>[];
    rowCount: number;
    returnedRows: number;
    truncated: boolean;
    elapsedMs: number;
}

import type { ChartPayload } from '../charts/types';

/** Charts embedded in chat messages share the dashboard contract. */
export type ChartData = ChartPayload;

/** One selectable option in an agent clarification question. */
export interface AskUserOption {
    label: string;
    description?: string;
}

/** A question the agent asks the user before continuing. */
export interface AskUserRequest {
    question: string;
    options?: AskUserOption[];
    multiple?: boolean;
    allowFreeText?: boolean;
}

/** The user's answer (or its absence) delivered back to the agent. */
export interface AskUserAnswer {
    selected?: string[];
    text?: string;
    canceled?: boolean;
    timeout?: boolean;
}

/** Q&A pair persisted in chat history for `ask_user` tool calls. */
export interface AgentQuestionRecord extends AskUserRequest {
    answer?: AskUserAnswer;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    thinking?: string;
    tool_calls?: any[];
    name?: string;
    tool_call_id?: string;
    timestamp: number;
    /** Same-source query result backing a tool call. */
    query?: QueryPreviewData;
    /** Same-source chart rendering for a tool call. */
    chart?: ChartData;
    /** Clarification question asked via the ask_user tool. */
    question?: AgentQuestionRecord;
    error?: boolean;
}
