import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * These tests run the real scanning/parsing code against a throwaway home
 * directory. Electron and electron-store are replaced so nothing touches the
 * developer's real agent configuration.
 */

const originalAppData = process.env.APPDATA;
const originalXdg = process.env.XDG_CONFIG_HOME;

let root: string;
let homeDir: string;
let workspaceDir: string;
let userDataDir: string;

let skills: typeof import('../electron/agents/skills');
let instructions: typeof import('../electron/agents/instructions');
let mcp: typeof import('../electron/agents/mcp');
let agents: typeof import('../electron/agents');

const storeState = new Map<string, unknown>();

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat2excel-agents-'));
    homeDir = path.join(root, 'home');
    workspaceDir = path.join(root, 'workspace');
    userDataDir = path.join(root, 'userData');

    process.env.APPDATA = path.join(root, 'appdata');
    process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
    storeState.set('agentWorkspace', workspaceDir);

    write(
        path.join(homeDir, '.claude', 'skills', 'weekly-report', 'SKILL.md'),
        [
            '---',
            'name: weekly-report',
            'description: Build a weekly sales report from the current database.',
            'version: 1.2.0',
            'author: Alice',
            '---',
            '# Weekly Report',
            '',
            'Aggregate revenue by week and compare it with the previous period.',
        ].join('\n')
    );
    write(
        path.join(homeDir, '.claude', 'skills', 'weekly-report', 'references', 'notes.md'),
        'notes'
    );
    write(
        path.join(homeDir, '.claude', 'skills', 'weekly-report', 'scripts', 'run.sql'),
        'select 1;'
    );

    write(
        path.join(workspaceDir, '.agents', 'skills', 'local-helper', 'SKILL.md'),
        '# Local Helper\n\nSummarize the current table in a few sentences.'
    );
    write(
        path.join(userDataDir, 'skills', 'managed-one', 'SKILL.md'),
        [
            '---',
            'name: managed-one',
            'description: A skill imported into the app data directory.',
            '---',
            'Body of the managed skill.',
        ].join('\n')
    );

    write(path.join(userDataDir, 'agents', 'instructions', 'default.md'), 'Always answer in Chinese.');
    write(path.join(workspaceDir, 'AGENTS.md'), 'Workspace rule: prefer revenue currency CNY.');
    write(path.join(homeDir, '.agents', 'AGENTS.md'), 'Global rule: keep answers short.');
    write(path.join(userDataDir, 'agents', 'instructions', 'big.md'), 'a'.repeat(15_000));

    write(
        path.join(homeDir, '.claude.json'),
        JSON.stringify({
            mcpServers: {
                filesystem: {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
                    env: { ACCESS_TOKEN: 'secret-value' },
                },
            },
        })
    );
    write(
        path.join(workspaceDir, '.mcp.json'),
        JSON.stringify({
            mcpServers: {
                remote: {
                    type: 'http',
                    url: 'https://example.com/mcp',
                    headers: { Authorization: 'Bearer secret' },
                },
            },
        })
    );
    write(
        path.join(homeDir, '.codex', 'config.toml'),
        ['[mcp_servers.codex-tool]', 'command = "node"', 'args = ["server.js"]'].join('\n')
    );
    write(path.join(homeDir, '.cursor', 'mcp.json'), '{ not valid json');

    vi.resetModules();
    vi.doMock('electron', () => ({
        app: {
            getPath: () => userDataDir,
            getAppPath: () => process.cwd(),
            getVersion: () => '0.0.0-test',
        },
    }));
    vi.doMock('node:os', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:os')>();
        const homedir = () => homeDir;
        return { ...actual, homedir, default: { ...actual, homedir } };
    });
    vi.doMock('../electron/store', () => ({
        store: {
            get: (key: string) => storeState.get(key),
            set: (key: string, value: unknown) => {
                storeState.set(key, value);
                return value;
            },
            delete: (key: string) => storeState.delete(key),
        },
    }));

    skills = await import('../electron/agents/skills');
    instructions = await import('../electron/agents/instructions');
    mcp = await import('../electron/agents/mcp');
    agents = await import('../electron/agents');
});

afterAll(() => {
    vi.doUnmock('electron');
    vi.doUnmock('node:os');
    vi.doUnmock('../electron/store');
    vi.resetModules();
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    fs.rmSync(root, { recursive: true, force: true });
});

describe('Agent Skills', () => {
    it('discovers skills from common agent directories and manages state', () => {
        const listed = skills.listSkills();
        const names = listed
            .filter((skill) => !skill.builtin)
            .map((skill) => skill.name)
            .sort();
        expect(names).toEqual(['local-helper', 'managed-one', 'weekly-report']);

        const weekly = listed.find((skill) => skill.name === 'weekly-report')!;
        expect(weekly.sourceLabel).toBe('Claude Code');
        expect(weekly.version).toBe('1.2.0');
        expect(weekly.author).toBe('Alice');
        expect(weekly.enabled).toBe(true);
        expect(weekly.managed).toBe(false);
        expect(weekly.warnings).toEqual([]);
        expect(weekly.files).toEqual(['SKILL.md', 'references/notes.md', 'scripts/run.sql']);

        const local = listed.find((skill) => skill.name === 'local-helper')!;
        expect(local.warnings.some((warning) => warning.includes('Missing name'))).toBe(true);
        expect(local.description).toContain('Summarize the current table');

        const managed = listed.find((skill) => skill.name === 'managed-one')!;
        expect(managed.managed).toBe(true);

        const detail = skills.readSkill(weekly.id)!;
        expect(detail.content).toContain('Aggregate revenue by week');

        expect(skills.setSkillEnabled(weekly.id, false)).toBe(true);
        expect(skills.getEnabledSkills().some((skill) => skill.id === weekly.id)).toBe(false);
        expect(skills.skillCatalogPrompt()).not.toContain('weekly-report');
        skills.setSkillEnabled(weekly.id, true);
        expect(skills.skillCatalogPrompt()).toContain('weekly-report');
    });

    it('loads shipped skills as read-only built-ins', () => {
        const builtins = skills.listSkills().filter((skill) => skill.builtin);
        const names = builtins.map((skill) => skill.name);
        expect(names).toEqual(
            expect.arrayContaining([
                'chat2excel-bi',
                'chat2excel-query-recipes',
                'chat2excel-excel-report',
            ])
        );
        for (const skill of builtins) {
            expect(skill.enabled).toBe(true);
            expect(skill.sourceKind).toBe('builtin');
            expect(skill.managed).toBe(false);
        }

        const bi = builtins.find((skill) => skill.name === 'chat2excel-bi')!;
        expect(skills.setSkillEnabled(bi.id, false)).toBe(false);
        expect(skills.removeSkill(bi.id)).toBe(false);
        expect(skills.readSkill(bi.id)!.content).toContain('list_tables');

        const catalog = skills.skillCatalogPrompt();
        expect(catalog).toContain('chat2excel-bi（内置）');
        expect(catalog).toContain('chat2excel-query-recipes');
    });

    it('imports a standalone Markdown skill into managed storage', () => {
        const source = path.join(root, 'Imported Skill.md');
        write(
            source,
            ['---', 'name: imported-skill', 'description: Imported from a file.', '---', 'Do it.'].join('\n')
        );

        expect(skills.importSkillFile(source)).toBe(1);
        const imported = skills.listSkills().find((skill) => skill.name === 'imported-skill')!;
        expect(imported.managed).toBe(true);
        expect(imported.description).toBe('Imported from a file.');
    });
});

describe('AGENTS.md instructions', () => {
    it('injects enabled files in managed, workspace, global order', () => {
        const prompt = instructions.instructionPrompt();
        expect(prompt).toContain('Always answer in Chinese.');
        expect(prompt).toContain('Workspace rule: prefer revenue currency CNY.');
        expect(prompt).toContain('Global rule: keep answers short.');

        const managedIndex = prompt.indexOf('Always answer in Chinese.');
        const workspaceIndex = prompt.indexOf('Workspace rule');
        const globalIndex = prompt.indexOf('Global rule');
        expect(managedIndex).toBeGreaterThanOrEqual(0);
        expect(workspaceIndex).toBeGreaterThan(managedIndex);
        expect(globalIndex).toBeGreaterThan(workspaceIndex);
        expect(prompt).toContain('<agent_instructions');
    });

    it('respects disabled state and truncates oversized files', () => {
        const workspace = instructions
            .listInstructions()
            .find((item) => item.path === path.join(workspaceDir, 'AGENTS.md'))!;
        expect(workspace).toBeTruthy();

        expect(instructions.setInstructionEnabled(workspace.id, false)).toBe(true);
        expect(instructions.instructionPrompt()).not.toContain('Workspace rule');
        instructions.setInstructionEnabled(workspace.id, true);

        expect(instructions.instructionPrompt()).toContain('[内容过长，已截断]');
    });

    it('saves edits to managed instruction files only', () => {
        const managed = instructions
            .listInstructions()
            .find((item) => item.name === 'default')!;
        expect(instructions.saveInstruction(managed.id, 'Updated managed instruction.')).toBe(true);
        expect(instructions.readInstruction(managed.id)!.content).toBe('Updated managed instruction.');

        const workspace = instructions
            .listInstructions()
            .find((item) => item.path === path.join(workspaceDir, 'AGENTS.md'))!;
        expect(instructions.saveInstruction(workspace.id, 'nope')).toBe(false);
    });
});

describe('MCP configuration', () => {
    it('normalizes JSON and TOML sources and keeps secrets in the main process', () => {
        const scan = mcp.scanMcpConfigs();
        const byName = new Map(scan.servers.map((server) => [server.name, server]));

        expect(byName.get('filesystem')?.transport).toBe('stdio');
        expect(byName.get('filesystem')?.env).toEqual({ ACCESS_TOKEN: 'secret-value' });
        expect(byName.get('remote')?.transport).toBe('http');
        expect(byName.get('remote')?.url).toBe('https://example.com/mcp');
        expect(byName.get('codex-tool')?.transport).toBe('stdio');
        expect(scan.warnings.some((warning) => warning.includes('Cursor'))).toBe(true);
    });

    it('lists scanned servers as disabled and redacts env/headers', () => {
        const listed = mcp.listMcpServers();
        const filesystem = listed.servers.find((server) => server.name === 'filesystem')!;
        expect(filesystem.enabled).toBe(false);
        expect(filesystem.managed).toBe(false);
        expect(filesystem.hasEnv).toBe(true);

        const info = mcp.toServerInfo(
            mcp.scanMcpConfigs().servers.find((server) => server.name === 'filesystem')!,
            false
        );
        expect(info.hasEnv).toBe(true);
        expect('env' in info).toBe(false);
        expect(JSON.stringify(info)).not.toContain('secret-value');
    });

    it('requires explicit enablement and supports import/remove', async () => {
        const scanned = mcp
            .scanMcpConfigs()
            .servers.find((server) => server.name === 'remote')!;
        expect(await mcp.setMcpEnabled(scanned.id, true)).toBe(true);

        const enabled = mcp.listMcpServers().servers.find((server) => server.id === scanned.id)!;
        expect(enabled.enabled).toBe(true);
        expect(enabled.managed).toBe(true);
        expect(enabled.status).toBe('disconnected');

        const importFile = path.join(root, 'extra-mcp.json');
        write(
            importFile,
            JSON.stringify({ mcpServers: { 'extra-tool': { command: 'node', args: ['extra.js'] } } })
        );
        expect(await mcp.importMcpFile(importFile)).toBe(1);
        const imported = mcp.listMcpServers().servers.find((server) => server.name === 'extra-tool')!;
        expect(imported.enabled).toBe(true);
        expect(imported.sourceLabel).toContain('Imported');

        expect(await mcp.removeMcpServer(imported.id)).toBe(true);
        expect(mcp.listMcpServers().servers.some((server) => server.name === 'extra-tool')).toBe(false);
    });
});

describe('Agent overview', () => {
    it('aggregates resources, stats and prompt extras', () => {
        const overview = agents.getAgentOverview();
        expect(overview.workspace).toBe(workspaceDir);
        expect(overview.stats.skills).toBeGreaterThanOrEqual(6);
        expect(overview.stats.skillsEnabled).toBeGreaterThanOrEqual(6);
        expect(overview.sources.skills.some((source) => source.scope === 'builtin')).toBe(true);
        expect(overview.stats.instructionsEnabled).toBeGreaterThanOrEqual(2);
        expect(overview.stats.mcpServers).toBeGreaterThanOrEqual(2);

        const extras = agents.agentPromptExtras();
        expect(extras.skills).toContain('可用 Skills');
        expect(extras.instructions).toContain('Updated managed instruction.');
    });
});
