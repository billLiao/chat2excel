/**
 * Shared types for the agent resource layer (skills, instructions, MCP).
 *
 * These types are imported by both the Electron main process and the renderer,
 * so they must stay free of Node or DOM specific APIs.
 */

export type AgentSourceKind =
    | 'builtin'
    | 'managed'
    | 'workspace'
    | 'claude'
    | 'codex'
    | 'agents'
    | 'pi'
    | 'cursor'
    | 'gemini'
    | 'qoder'
    | 'copilot'
    | 'other';

export interface AgentSourceInfo {
    id: string;
    label: string;
    kind: AgentSourceKind;
    path: string;
    exists: boolean;
    scope: 'builtin' | 'managed' | 'workspace' | 'global';
}

export interface AgentSkill {
    id: string;
    name: string;
    description: string;
    version?: string;
    author?: string;
    /** Absolute path to SKILL.md. */
    path: string;
    /** Absolute path to the skill directory. */
    dir: string;
    sourceId: string;
    sourceLabel: string;
    sourceKind: AgentSourceKind;
    enabled: boolean;
    managed: boolean;
    /** Shipped with the app; always enabled and cannot be removed. */
    builtin: boolean;
    size: number;
    preview: string;
    files: string[];
    warnings: string[];
}

export interface AgentSkillDetail extends AgentSkill {
    content: string;
}

export interface AgentInstruction {
    id: string;
    name: string;
    path: string;
    sourceId: string;
    sourceLabel: string;
    sourceKind: AgentSourceKind;
    enabled: boolean;
    managed: boolean;
    size: number;
    preview: string;
}

export interface AgentInstructionDetail extends AgentInstruction {
    content: string;
}

export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpServerStatus = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpToolSummary {
    name: string;
    title?: string;
    description?: string;
}

export interface McpServerInfo {
    id: string;
    name: string;
    transport: McpTransport;
    command?: string;
    args?: string[];
    url?: string;
    cwd?: string;
    enabled: boolean;
    managed: boolean;
    sourceId: string;
    sourceLabel: string;
    sourcePath?: string;
    hasEnv: boolean;
    hasHeaders: boolean;
    status: McpServerStatus;
    error?: string;
    tools: McpToolSummary[];
}

export interface AgentOverview {
    skills: AgentSkill[];
    instructions: AgentInstruction[];
    mcpServers: McpServerInfo[];
    sources: {
        skills: AgentSourceInfo[];
        instructions: AgentSourceInfo[];
        mcp: AgentSourceInfo[];
    };
    workspace: string | null;
    stats: {
        skills: number;
        skillsEnabled: number;
        instructions: number;
        instructionsEnabled: number;
        mcpServers: number;
        mcpEnabled: number;
        mcpConnected: number;
        mcpTools: number;
    };
    warnings: string[];
}

export interface AgentActionResult {
    success: boolean;
    error?: string;
    message?: string;
}

export interface AgentImportResult extends AgentActionResult {
    imported: number;
    overview?: AgentOverview;
}

export interface McpTestResult extends AgentActionResult {
    server?: McpServerInfo;
}

export interface McpServerConfig {
    id: string;
    name: string;
    transport: McpTransport;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    cwd?: string;
}
