import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
    McpServerConfig,
    McpServerInfo,
    McpServerStatus,
    McpToolSummary,
    McpTransport,
} from '../../src/lib/agents/types';
import { store } from '../store';
import { mcpConfigSources, readTextFile, sourceInfo, stableId } from './paths';

const MCP_STORE_KEY = 'mcpServers';
const CONNECT_TIMEOUT_MS = 30_000;
const LIST_TOOLS_TIMEOUT_MS = 20_000;
const CALL_TOOL_TIMEOUT_MS = 60_000;
const MAX_TOOL_TEXT = 30_000;

export interface StoredMcpServer extends McpServerConfig {
    enabled: boolean;
    managed: true;
    sourceId: string;
    sourceLabel: string;
    sourcePath?: string;
    importedAt: number;
}

interface McpToolEntry extends McpToolSummary {
    inputSchema?: unknown;
}

interface ScannedMcpServer extends StoredMcpServer {
    managed: true;
}

interface McpConnection {
    client?: Client;
    tools: McpToolEntry[];
    status: McpServerStatus;
    error?: string;
}

const connections = new Map<string, McpConnection>();

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined;
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item === null || item === undefined) continue;
        result[key] = typeof item === 'string' ? item : String(item);
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeTransport(raw: Record<string, any>): McpTransport {
    const declared = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
    if (declared === 'sse') return 'sse';
    if (declared === 'http' || declared === 'streamable-http' || declared === 'streamablehttp') {
        return 'http';
    }
    if (typeof raw.url === 'string' && raw.url) return 'http';
    return 'stdio';
}

function normalizeServer(
    name: string,
    raw: unknown,
    meta: { id: string; sourceId: string; sourceLabel: string; sourcePath?: string }
): StoredMcpServer | null {
    if (!isRecord(raw)) return null;
    const transport = normalizeTransport(raw);
    const command = typeof raw.command === 'string' ? raw.command.trim() : undefined;
    const url = typeof raw.url === 'string' ? raw.url.trim() : undefined;
    if (transport === 'stdio' && !command) return null;
    if (transport !== 'stdio' && !url) return null;

    const args = Array.isArray(raw.args) ? raw.args.map((item: unknown) => String(item)) : undefined;
    const env = stringRecord(raw.env);
    const headers = stringRecord(raw.headers);
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined;

    return {
        id: meta.id,
        name,
        transport,
        command,
        args,
        env,
        url,
        headers,
        cwd,
        enabled: false,
        managed: true,
        sourceId: meta.sourceId,
        sourceLabel: meta.sourceLabel,
        sourcePath: meta.sourcePath,
        importedAt: Date.now(),
    };
}

function serversFromObject(
    value: unknown,
    meta: { sourceId: string; sourceLabel: string; sourcePath: string }
): StoredMcpServer[] {
    if (!isRecord(value)) return [];
    const container = isRecord(value.mcpServers)
        ? value.mcpServers
        : isRecord(value.mcp_servers)
          ? value.mcp_servers
          : isRecord(value.servers)
            ? value.servers
            : null;
    if (!container) return [];
    const result: StoredMcpServer[] = [];
    for (const [name, raw] of Object.entries(container)) {
        const id = stableId('mcp', `${meta.sourcePath}::${name}`);
        const server = normalizeServer(name, raw, { ...meta, id });
        if (server) result.push(server);
    }
    return result;
}

function readConfigFile(
    filePath: string,
    meta: { sourceId: string; sourceLabel: string }
): { servers: StoredMcpServer[]; error?: string } {
    try {
        const content = readTextFile(filePath, 2 * 1024 * 1024);
        const parsed = path.extname(filePath).toLowerCase() === '.toml'
            ? parseToml(content)
            : JSON.parse(content);
        return {
            servers: serversFromObject(parsed, { ...meta, sourcePath: filePath }),
        };
    } catch (error: any) {
        return {
            servers: [],
            error: `${meta.sourceLabel}: ${error?.message || error}`,
        };
    }
}

function readStoredServers(): StoredMcpServer[] {
    const value = store.get(MCP_STORE_KEY);
    if (!Array.isArray(value)) return [];
    return value.filter(
        (item): item is StoredMcpServer =>
            isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
    );
}

function saveStoredServers(servers: StoredMcpServer[]): void {
    store.set(MCP_STORE_KEY, servers);
}

export function scanMcpConfigs(): {
    servers: ScannedMcpServer[];
    sources: ReturnType<typeof sourceInfo>[];
    warnings: string[];
} {
    const servers: ScannedMcpServer[] = [];
    const warnings: string[] = [];
    const sources = mcpConfigSources();

    for (const source of sources) {
        if (!fs.existsSync(source.path)) continue;
        const result = readConfigFile(source.path, {
            sourceId: source.id,
            sourceLabel: source.label,
        });
        if (result.error) warnings.push(result.error);
        servers.push(...result.servers.map((server) => ({ ...server, managed: true as const })));
    }

    return {
        servers: dedupeServers(servers),
        sources: sources.map(sourceInfo),
        warnings,
    };
}

function dedupeServers<T extends StoredMcpServer>(servers: T[]): T[] {
    const seen = new Set<string>();
    return servers.filter((server) => {
        if (seen.has(server.id)) return false;
        seen.add(server.id);
        return true;
    });
}

function isSameOrigin(server: StoredMcpServer, other: StoredMcpServer): boolean {
    return (
        server.name === other.name &&
        (server.sourcePath || '') === (other.sourcePath || '') &&
        (server.sourceId || '') === (other.sourceId || '')
    );
}

function findStored(id: string): StoredMcpServer | null {
    return readStoredServers().find((server) => server.id === id) || null;
}

function findScanned(id: string): ScannedMcpServer | null {
    return scanMcpConfigs().servers.find((server) => server.id === id) || null;
}

function connectionFor(id: string): McpConnection | undefined {
    return connections.get(id);
}

function statusOf(config: StoredMcpServer): McpConnection {
    const existing = connectionFor(config.id);
    if (!config.enabled) {
        return { status: 'disabled', tools: existing?.tools || [] };
    }
    return existing || { status: 'disconnected', tools: [] };
}

export function toServerInfo(
    config: StoredMcpServer,
    managed: boolean,
    override?: McpConnection
): McpServerInfo {
    const connection = override || statusOf(config);
    return {
        id: config.id,
        name: config.name,
        transport: config.transport,
        command: config.command,
        args: config.args,
        url: config.url,
        cwd: config.cwd,
        enabled: config.enabled,
        managed,
        sourceId: config.sourceId,
        sourceLabel: config.sourceLabel,
        sourcePath: config.sourcePath,
        hasEnv: !!config.env && Object.keys(config.env).length > 0,
        hasHeaders: !!config.headers && Object.keys(config.headers).length > 0,
        status: connection.status,
        error: connection.error,
        tools: connection.tools.map(({ name, title, description }) => ({
            name,
            title,
            description,
        })),
    };
}

export function listMcpServers(): {
    servers: McpServerInfo[];
    sources: ReturnType<typeof sourceInfo>[];
    warnings: string[];
} {
    const stored = readStoredServers();
    const scan = scanMcpConfigs();
    const merged: McpServerInfo[] = stored.map((server) => toServerInfo(server, true));
    for (const scanned of scan.servers) {
        if (stored.some((server) => isSameOrigin(server, scanned))) continue;
        merged.push(toServerInfo({ ...scanned, enabled: false }, false));
    }
    merged.sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return {
        servers: merged,
        sources: scan.sources,
        warnings: scan.warnings,
    };
}

async function createTransport(config: StoredMcpServer): Promise<any> {
    if (config.transport === 'stdio') {
        if (!config.command) throw new Error('MCP stdio server is missing a command.');
        const { StdioClientTransport, getDefaultEnvironment } = await import(
            '@modelcontextprotocol/sdk/client/stdio.js'
        );
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            cwd: config.cwd,
            env: { ...getDefaultEnvironment(), ...(config.env || {}) },
            stderr: 'pipe',
        });
        transport.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8').trim();
            if (text) console.log(`[MCP:${config.name}] ${text.slice(0, 500)}`);
        });
        return transport;
    }

    if (!config.url) throw new Error('MCP HTTP server is missing a URL.');
    const requestInit: RequestInit | undefined = config.headers
        ? { headers: config.headers }
        : undefined;

    if (config.transport === 'sse') {
        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
        return new SSEClientTransport(new URL(config.url), { requestInit });
    }
    const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit });
}

async function connectConfig(config: StoredMcpServer): Promise<{
    client: Client;
    tools: McpToolEntry[];
}> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const transport = await createTransport(config);
    const client = new Client(
        { name: 'chat2excel', version: app.getVersion() },
        { capabilities: {} }
    );
    try {
        await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
        const listed = await client.listTools(undefined, { timeout: LIST_TOOLS_TIMEOUT_MS });
        const tools = (listed.tools || []).map((tool) => ({
            name: tool.name,
            title: (tool as any).title || undefined,
            description: tool.description || undefined,
            inputSchema: (tool as any).inputSchema,
        }));
        return { client, tools };
    } catch (error) {
        try {
            await client.close();
        } catch {
            // ignore
        }
        throw error;
    }
}

async function ensureConnection(config: StoredMcpServer): Promise<McpConnection> {
    const existing = connections.get(config.id);
    if (existing?.status === 'connected' && existing.client) return existing;

    connections.set(config.id, { status: 'connecting', tools: [] });
    try {
        const { client, tools } = await connectConfig(config);
        const connection: McpConnection = { client, tools, status: 'connected' };
        connections.set(config.id, connection);
        return connection;
    } catch (error: any) {
        const connection: McpConnection = {
            status: 'error',
            tools: [],
            error: error?.message || String(error),
        };
        connections.set(config.id, connection);
        return connection;
    }
}

async function closeConnection(id: string): Promise<void> {
    const connection = connections.get(id);
    connections.delete(id);
    if (!connection?.client) return;
    try {
        await connection.client.close();
    } catch (error) {
        console.warn(`[MCP] Failed to close connection ${id}:`, error);
    }
}

export async function setMcpEnabled(id: string, enabled: boolean): Promise<boolean> {
    const stored = findStored(id);
    if (stored) {
        const servers = readStoredServers().map((server) =>
            server.id === id ? { ...server, enabled } : server
        );
        saveStoredServers(servers);
        if (!enabled) await closeConnection(id);
        return true;
    }

    if (!enabled) return false;
    const scanned = findScanned(id);
    if (!scanned) return false;

    const servers = readStoredServers();
    if (!servers.some((server) => server.id === scanned.id)) {
        servers.push({ ...scanned, enabled: true });
        saveStoredServers(servers);
    }
    return true;
}

export async function testMcpServer(id: string): Promise<McpServerInfo> {
    const stored = findStored(id);
    if (stored) {
        const connection = await ensureConnection({ ...stored, enabled: true });
        if (!stored.enabled) {
            await closeConnection(stored.id);
            connections.set(stored.id, { status: 'disabled', tools: connection.tools });
        }
        return toServerInfo(stored, true, connections.get(stored.id) || connection);
    }

    const scanned = findScanned(id);
    if (!scanned) throw new Error('MCP server not found.');
    const connection = await ensureConnection({ ...scanned, enabled: true });
    try {
        return toServerInfo({ ...scanned, enabled: false }, false, connection);
    } finally {
        await closeConnection(scanned.id);
    }
}

export async function removeMcpServer(id: string): Promise<boolean> {
    const servers = readStoredServers();
    if (!servers.some((server) => server.id === id)) return false;
    await closeConnection(id);
    saveStoredServers(servers.filter((server) => server.id !== id));
    return true;
}

export async function importMcpFile(filePath: string): Promise<number> {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('The selected path is not a file.');
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.json' && ext !== '.toml') {
        throw new Error('Select a JSON or TOML MCP configuration file.');
    }
    const result = readConfigFile(filePath, {
        sourceId: 'manual-import',
        sourceLabel: `Imported · ${path.basename(filePath)}`,
    });
    if (result.error) throw new Error(result.error);
    if (result.servers.length === 0) {
        throw new Error('No MCP servers found in the selected file.');
    }

    const servers = readStoredServers();
    let imported = 0;
    for (const server of result.servers) {
        const next: StoredMcpServer = {
            ...server,
            id: stableId('mcp', `manual::${filePath}::${server.name}`),
            sourceId: 'manual-import',
            sourceLabel: `Imported · ${path.basename(filePath)}`,
            sourcePath: filePath,
            enabled: true,
        };
        const index = servers.findIndex((item) => item.id === next.id);
        if (index >= 0) {
            servers[index] = { ...next };
        } else {
            servers.push(next);
        }
        imported += 1;
    }
    saveStoredServers(servers);
    return imported;
}

export async function refreshMcpConnections(): Promise<void> {
    const enabled = readStoredServers().filter((server) => server.enabled);
    for (const server of enabled) {
        await closeConnection(server.id);
    }
    await Promise.all(enabled.map((server) => ensureConnection(server)));
}

export async function closeAllMcpConnections(): Promise<void> {
    const ids = Array.from(connections.keys());
    await Promise.all(ids.map((id) => closeConnection(id)));
}

function sanitizeToolPart(value: string): string {
    return value
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
}

function mcpResultToContent(result: any): {
    content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
    isError: boolean;
} {
    const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [];
    let remaining = MAX_TOOL_TEXT;
    const pushText = (text: string) => {
        if (remaining <= 0 || !text) return;
        const slice = text.slice(0, remaining);
        content.push({ type: 'text', text: slice });
        remaining -= slice.length;
    };

    for (const item of Array.isArray(result?.content) ? result.content : []) {
        if (item?.type === 'text') {
            pushText(String(item.text || ''));
        } else if (item?.type === 'image' && item.data && item.mimeType) {
            content.push({ type: 'image', data: String(item.data), mimeType: String(item.mimeType) });
        } else if (item?.type === 'resource' && item.resource) {
            const resource = item.resource;
            pushText(
                `Resource ${resource.uri || ''}\n${
                    resource.text ?? JSON.stringify(resource.blob ?? resource, null, 2)
                }`
            );
        } else if (item?.type === 'resource_link') {
            pushText(`Resource link: ${item.name || ''} ${item.uri || ''}`);
        }
    }

    if (content.length === 0 && result?.structuredContent) {
        pushText(JSON.stringify(result.structuredContent, null, 2));
    }
    if (content.length === 0) {
        pushText('MCP tool returned no content.');
    }
    return { content, isError: !!result?.isError };
}

export async function mcpAgentTools(): Promise<AgentTool<any, any>[]> {
    const enabled = readStoredServers().filter((server) => server.enabled);
    if (enabled.length === 0) return [];

    await Promise.all(enabled.map((server) => ensureConnection(server)));

    const tools: AgentTool<any, any>[] = [];
    const usedNames = new Set<string>();

    for (const config of enabled) {
        const connection = connections.get(config.id);
        if (!connection || connection.status !== 'connected' || !connection.client) continue;
        const client = connection.client;

        for (const tool of connection.tools) {
            const baseName = `mcp_${sanitizeToolPart(config.name)}_${sanitizeToolPart(tool.name)}`;
            let name = baseName;
            let suffix = 2;
            while (usedNames.has(name)) {
                name = `${baseName}_${suffix}`;
                suffix += 1;
            }
            usedNames.add(name);

            const rawSchema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
            const schema = Type.Unsafe<Record<string, unknown>>({
                ...rawSchema,
                type: 'object',
                properties: isRecord(rawSchema.properties) ? rawSchema.properties : {},
                additionalProperties:
                    typeof rawSchema.additionalProperties === 'boolean'
                        ? rawSchema.additionalProperties
                        : true,
            } as any);

            tools.push({
                name,
                label: `${config.name}: ${tool.title || tool.name}`,
                description:
                    tool.description ||
                    `MCP tool "${tool.name}" provided by the local "${config.name}" server.`,
                parameters: schema,
                execute: async (_toolCallId: string, params: any, signal?: AbortSignal) => {
                    try {
                        const result = await client.callTool(
                            {
                                name: tool.name,
                                arguments:
                                    params && typeof params === 'object'
                                        ? (params as Record<string, unknown>)
                                        : {},
                            },
                            undefined,
                            { timeout: CALL_TOOL_TIMEOUT_MS, signal }
                        );
                        const mapped = mcpResultToContent(result);
                        return {
                            content: mapped.content,
                            details: {
                                kind: 'mcp',
                                server: config.name,
                                tool: tool.name,
                            },
                            isError: mapped.isError,
                        };
                    } catch (error: any) {
                        throw new Error(
                            `MCP tool ${config.name}/${tool.name} failed: ${
                                error?.message || error
                            }`
                        );
                    }
                },
            });
        }
    }

    return tools;
}

export function mcpSources(): ReturnType<typeof mcpConfigSources> {
    return mcpConfigSources();
}
