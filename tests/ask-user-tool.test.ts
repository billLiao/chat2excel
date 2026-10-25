import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testRoot = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-ask-test-${process.pid}`
);

vi.mock('electron', () => ({
    app: {
        getPath: () => `${testRoot}/userData`,
        getAppPath: () => process.cwd(),
        getVersion: () => '0.0.0-test',
    },
}));

vi.mock('../electron/store', () => ({
    store: {
        get: () => undefined,
        set: () => undefined,
        delete: () => undefined,
    },
}));

vi.mock('electron-store', () => {
    class MemoryStore {
        private data: Record<string, unknown>;
        constructor(options?: { defaults?: Record<string, unknown> }) {
            this.data = JSON.parse(JSON.stringify(options?.defaults || {}));
        }
        get(key: string) {
            return this.data[key];
        }
        set(key: string, value: unknown) {
            this.data[key] = JSON.parse(JSON.stringify(value));
        }
        delete(key: string) {
            delete this.data[key];
        }
    }
    return { default: MemoryStore };
});

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();
    const homedir = () => `${testRoot}/home`;
    return { ...actual, homedir, default: { ...actual, homedir } };
});

let toolsModule: typeof import('../electron/agent/tools');

beforeAll(async () => {
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    toolsModule = await import('../electron/agent/tools');
});

afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('normalizeAskUserRequest', () => {
    it('requires a non-empty question', () => {
        expect(() => toolsModule.normalizeAskUserRequest({})).toThrow(/question/i);
        expect(() => toolsModule.normalizeAskUserRequest({ question: '   ' })).toThrow(/question/i);
    });

    it('normalizes string and object options, capped at six', () => {
        const request = toolsModule.normalizeAskUserRequest({
            question: '时间范围？',
            options: [
                '最近 7 天',
                { label: ' 本月 ', description: ' 自然月 ' },
                { label: '' },
                42,
            ].concat(Array.from({ length: 6 }, (_, i) => `extra-${i}`)),
        });
        expect(request.question).toBe('时间范围？');
        expect(request.options).toHaveLength(6);
        expect(request.options?.[0]).toEqual({ label: '最近 7 天' });
        expect(request.options?.[1]).toEqual({
            label: '本月',
            description: '自然月',
        });
        expect(request.multiple).toBe(false);
        expect(request.allowFreeText).toBe(true);
    });

    it('keeps allowFreeText=false when options exist and the model disables it', () => {
        const request = toolsModule.normalizeAskUserRequest({
            question: 'q',
            options: [{ label: 'a' }, { label: 'b' }],
            allowFreeText: false,
        });
        expect(request.allowFreeText).toBe(false);
    });

    it('treats empty option lists as an open question', () => {
        const request = toolsModule.normalizeAskUserRequest({ question: 'q', options: [] });
        expect(request.options).toBeUndefined();
        expect(request.allowFreeText).toBe(true);
    });
});

describe('formatAskUserAnswer', () => {
    const request = { question: '时间范围？', options: [{ label: '本月' }] };

    it('formats a timeout with an explicit continue instruction', () => {
        const text = toolsModule.formatAskUserAnswer(request, { timeout: true });
        expect(text).toMatch(/did not answer/i);
        expect(text).toMatch(/assumption/i);
    });

    it('formats a cancellation', () => {
        expect(toolsModule.formatAskUserAnswer(request, { canceled: true })).toContain('用户中止');
    });

    it('formats selected options and free text', () => {
        const text = toolsModule.formatAskUserAnswer(request, {
            selected: ['本月'],
            text: '只看华东',
        });
        expect(text).toContain('时间范围？');
        expect(text).toContain('用户选择：本月');
        expect(text).toContain('用户补充：只看华东');
    });

    it('falls back to a continue instruction for an empty answer', () => {
        const text = toolsModule.formatAskUserAnswer(request, {});
        expect(text).toMatch(/最合理的口径|assumption/i);
    });
});

describe('ask_user tool', () => {
    it('is registered last among default tools', async () => {
        const tools = await toolsModule.createDefaultAgentTools({ queryIds: new Set() });
        expect(tools.at(-1)?.name).toBe('ask_user');
    });

    it('throws when no question channel is wired', async () => {
        const tools = await toolsModule.createDefaultAgentTools({ queryIds: new Set() });
        const ask = tools.find((tool) => tool.name === 'ask_user')!;
        await expect(ask.execute('call-1', { question: 'q' })).rejects.toThrow(
            /channel|unavailable/i
        );
    });

    it('pauses on askUser, returns the formatted answer, and records details', async () => {
        let receivedToolCallId = '';
        let receivedRequest: unknown;
        const tools = await toolsModule.createDefaultAgentTools({
            queryIds: new Set(),
            askUser: async (toolCallId, request) => {
                receivedToolCallId = toolCallId;
                receivedRequest = request;
                return { selected: ['本月'] };
            },
        });
        const ask = tools.find((tool) => tool.name === 'ask_user')!;
        const result = await ask.execute('call-42', {
            question: '时间范围？',
            options: [{ label: '本月' }, { label: '上月' }],
        });
        expect(receivedToolCallId).toBe('call-42');
        expect((receivedRequest as { question: string }).question).toBe('时间范围？');

        const details = (result as { details?: Record<string, unknown> }).details;
        expect(details?.kind).toBe('ask_user');
        expect((details?.question as { question: string }).question).toBe('时间范围？');
        const text = (result as {
            content: { type: string; text: string }[];
        }).content[0].text;
        expect(text).toContain('用户选择：本月');
    });

    it('throws on a canceled answer so the run stops', async () => {
        const tools = await toolsModule.createDefaultAgentTools({
            queryIds: new Set(),
            askUser: async () => ({ canceled: true }),
        });
        const ask = tools.find((tool) => tool.name === 'ask_user')!;
        await expect(ask.execute('call-7', { question: 'q' })).rejects.toThrow('用户中止');
    });
});
