import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { AgentSourceInfo, AgentSourceKind } from '../../src/lib/agents/types';
import { store } from '../store';

const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'out',
    'target',
    'vendor',
    '__pycache__',
    '.venv',
    'venv',
]);

export interface SourceRoot {
    id: string;
    label: string;
    kind: AgentSourceKind;
    path: string;
    scope: 'builtin' | 'managed' | 'workspace' | 'global';
}

/**
 * Skills shipped inside the app bundle. In development this is the repository
 * `resources/skills` folder; in a packaged build it is read from app.asar.
 */
export function builtinSkillsRoot(): string {
    return path.join(app.getAppPath(), 'resources', 'skills');
}

export function managedSkillsRoot(): string {
    return path.join(app.getPath('userData'), 'skills');
}

export function managedInstructionsRoot(): string {
    return path.join(app.getPath('userData'), 'agents', 'instructions');
}

export function getWorkspace(): string | null {
    const value = store.get('agentWorkspace');
    return typeof value === 'string' && value.trim() ? path.resolve(value) : null;
}

export function setWorkspace(value: string | null): void {
    if (value && value.trim()) {
        store.set('agentWorkspace', path.resolve(value));
    } else {
        store.delete('agentWorkspace');
    }
}

export function stableId(prefix: string, value: string): string {
    const digest = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
    return `${prefix}_${digest}`;
}

export function isInside(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

export function readTextFile(filePath: string, maxBytes = 512 * 1024): string {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('Not a file.');
    if (stat.size > maxBytes) {
        throw new Error(`File is larger than ${Math.round(maxBytes / 1024)} KB.`);
    }
    return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

export function listDirectory(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

export function sourceInfo(root: SourceRoot): AgentSourceInfo {
    let exists = false;
    try {
        exists = fs.existsSync(root.path);
    } catch {
        exists = false;
    }
    return { ...root, exists };
}

function home(...parts: string[]): string {
    return path.join(os.homedir(), ...parts);
}

function appData(...parts: string[]): string {
    if (process.platform === 'win32') {
        const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(base, ...parts);
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), ...parts);
}

export function skillRoots(): SourceRoot[] {
    const workspace = getWorkspace();
    const roots: SourceRoot[] = [
        {
            id: 'builtin-skills',
            label: 'Chat2Excel Built-in',
            kind: 'builtin',
            path: builtinSkillsRoot(),
            scope: 'builtin',
        },
        {
            id: 'managed-skills',
            label: 'Chat2Excel',
            kind: 'managed',
            path: managedSkillsRoot(),
            scope: 'managed',
        },
        { id: 'claude-skills', label: 'Claude Code', kind: 'claude', path: home('.claude', 'skills'), scope: 'global' },
        { id: 'codex-skills', label: 'Codex', kind: 'codex', path: home('.codex', 'skills'), scope: 'global' },
        { id: 'agents-skills', label: 'AGENTS', kind: 'agents', path: home('.agents', 'skills'), scope: 'global' },
        {
            id: 'agents-xdg-skills',
            label: 'AGENTS (XDG)',
            kind: 'agents',
            path: path.join(process.env.XDG_CONFIG_HOME || home('.config'), 'agents', 'skills'),
            scope: 'global',
        },
        { id: 'pi-skills', label: 'Pi', kind: 'pi', path: home('.pi', 'skills'), scope: 'global' },
        { id: 'pi-agent-skills', label: 'Pi Agent', kind: 'pi', path: home('.pi', 'agent', 'skills'), scope: 'global' },
        { id: 'cursor-skills', label: 'Cursor', kind: 'cursor', path: home('.cursor', 'skills'), scope: 'global' },
        { id: 'gemini-skills', label: 'Gemini CLI', kind: 'gemini', path: home('.gemini', 'skills'), scope: 'global' },
        { id: 'qoder-skills', label: 'Qoder', kind: 'qoder', path: home('.qoder', 'skills'), scope: 'global' },
        {
            id: 'copilot-skills',
            label: 'GitHub Copilot',
            kind: 'copilot',
            path: home('.copilot', 'skills'),
            scope: 'global',
        },
    ];

    if (workspace) {
        roots.push(
            { id: 'workspace-agents-skills', label: 'Workspace · AGENTS', kind: 'workspace', path: path.join(workspace, '.agents', 'skills'), scope: 'workspace' },
            { id: 'workspace-claude-skills', label: 'Workspace · Claude', kind: 'workspace', path: path.join(workspace, '.claude', 'skills'), scope: 'workspace' },
            { id: 'workspace-codex-skills', label: 'Workspace · Codex', kind: 'workspace', path: path.join(workspace, '.codex', 'skills'), scope: 'workspace' },
            { id: 'workspace-pi-skills', label: 'Workspace · Pi', kind: 'workspace', path: path.join(workspace, '.pi', 'skills'), scope: 'workspace' },
            { id: 'workspace-cursor-skills', label: 'Workspace · Cursor', kind: 'workspace', path: path.join(workspace, '.cursor', 'skills'), scope: 'workspace' }
        );
    }

    return roots;
}

export interface InstructionRoot extends SourceRoot {
    /** A file source (AGENTS.md / CLAUDE.md) instead of a directory. */
    file: boolean;
}

export function instructionRoots(): InstructionRoot[] {
    const workspace = getWorkspace();
    const roots: InstructionRoot[] = [
        {
            id: 'managed-instructions',
            label: 'Chat2Excel',
            kind: 'managed',
            path: managedInstructionsRoot(),
            scope: 'managed',
            file: false,
        },
        {
            id: 'agents-instructions',
            label: 'AGENTS',
            kind: 'agents',
            path: home('.agents', 'AGENTS.md'),
            scope: 'global',
            file: true,
        },
        {
            id: 'agents-xdg-instructions',
            label: 'AGENTS (XDG)',
            kind: 'agents',
            path: path.join(process.env.XDG_CONFIG_HOME || home('.config'), 'agents', 'AGENTS.md'),
            scope: 'global',
            file: true,
        },
        { id: 'claude-instructions', label: 'Claude Code', kind: 'claude', path: home('.claude', 'CLAUDE.md'), scope: 'global', file: true },
        { id: 'codex-instructions', label: 'Codex', kind: 'codex', path: home('.codex', 'AGENTS.md'), scope: 'global', file: true },
        { id: 'pi-instructions', label: 'Pi', kind: 'pi', path: home('.pi', 'AGENTS.md'), scope: 'global', file: true },
    ];

    if (workspace) {
        roots.push(
            { id: 'workspace-agents-md', label: 'Workspace · AGENTS.md', kind: 'workspace', path: path.join(workspace, 'AGENTS.md'), scope: 'workspace', file: true },
            { id: 'workspace-claude-md', label: 'Workspace · CLAUDE.md', kind: 'workspace', path: path.join(workspace, 'CLAUDE.md'), scope: 'workspace', file: true },
            { id: 'workspace-agents-dir-md', label: 'Workspace · .agents', kind: 'workspace', path: path.join(workspace, '.agents', 'AGENTS.md'), scope: 'workspace', file: true },
            { id: 'workspace-claude-dir-md', label: 'Workspace · .claude', kind: 'workspace', path: path.join(workspace, '.claude', 'CLAUDE.md'), scope: 'workspace', file: true }
        );
    }

    return roots;
}

export interface McpConfigSource {
    id: string;
    label: string;
    kind: AgentSourceKind;
    path: string;
    scope: 'workspace' | 'global';
}

export function mcpConfigSources(): McpConfigSource[] {
    const workspace = getWorkspace();
    const sources: McpConfigSource[] = [
        { id: 'claude-desktop-mcp', label: 'Claude Desktop', kind: 'claude', path: appData('Claude', 'claude_desktop_config.json'), scope: 'global' },
        { id: 'claude-code-mcp', label: 'Claude Code', kind: 'claude', path: home('.claude.json'), scope: 'global' },
        { id: 'cursor-mcp', label: 'Cursor', kind: 'cursor', path: home('.cursor', 'mcp.json'), scope: 'global' },
        { id: 'vscode-mcp', label: 'VS Code', kind: 'other', path: appData('Code', 'User', 'mcp.json'), scope: 'global' },
        { id: 'codex-mcp', label: 'Codex', kind: 'codex', path: home('.codex', 'config.toml'), scope: 'global' },
        { id: 'agents-mcp', label: 'AGENTS', kind: 'agents', path: home('.agents', 'mcp.json'), scope: 'global' },
        {
            id: 'agents-xdg-mcp',
            label: 'AGENTS (XDG)',
            kind: 'agents',
            path: path.join(process.env.XDG_CONFIG_HOME || home('.config'), 'agents', 'mcp.json'),
            scope: 'global',
        },
        { id: 'pi-mcp', label: 'Pi', kind: 'pi', path: home('.pi', 'mcp.json'), scope: 'global' },
    ];

    if (workspace) {
        sources.push(
            { id: 'workspace-mcp', label: 'Workspace · .mcp.json', kind: 'workspace', path: path.join(workspace, '.mcp.json'), scope: 'workspace' },
            { id: 'workspace-vscode-mcp', label: 'Workspace · VS Code', kind: 'workspace', path: path.join(workspace, '.vscode', 'mcp.json'), scope: 'workspace' },
            { id: 'workspace-cursor-mcp', label: 'Workspace · Cursor', kind: 'workspace', path: path.join(workspace, '.cursor', 'mcp.json'), scope: 'workspace' }
        );
    }

    return sources;
}

export function shouldSkipDir(name: string): boolean {
    return name.startsWith('.') && name !== '.agents' && name !== '.claude' && name !== '.pi' && name !== '.cursor'
        ? true
        : SKIP_DIRS.has(name);
}

export function slugify(value: string, fallback = 'skill'): string {
    const slug = value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return slug || fallback;
}

export function uniquePath(parent: string, slug: string): string {
    let candidate = path.join(parent, slug);
    let counter = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(parent, `${slug}-${counter}`);
        counter += 1;
    }
    return candidate;
}
