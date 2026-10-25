import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
    AgentSkill,
    AgentSkillDetail,
    AgentSourceKind,
} from '../../src/lib/agents/types';
import { store } from '../store';
import {
    ensureDir,
    isInside,
    listDirectory,
    managedSkillsRoot,
    readTextFile,
    shouldSkipDir,
    skillRoots,
    slugify,
    sourceInfo,
    stableId,
    uniquePath,
    type SourceRoot,
} from './paths';

const SKILL_STATE_KEY = 'agentSkillState';
const MAX_SKILLS = 250;
const MAX_SCAN_DEPTH = 3;
const MAX_FILES = 60;

interface Frontmatter {
    data: Record<string, unknown>;
    body: string;
    warnings: string[];
}

function parseFrontmatter(raw: string): Frontmatter {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!match) {
        return { data: {}, body: raw, warnings: [] };
    }
    try {
        const parsed = parseYaml(match[1]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return { data: parsed as Record<string, unknown>, body: match[2], warnings: [] };
        }
        return { data: {}, body: match[2], warnings: ['SKILL.md frontmatter is not an object.'] };
    } catch (error: any) {
        return {
            data: {},
            body: match[2],
            warnings: [`Invalid YAML frontmatter: ${error?.message || error}`],
        };
    }
}

function firstParagraph(body: string): string {
    const lines = body.split(/\r?\n/);
    const paragraph: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (paragraph.length > 0) break;
            continue;
        }
        if (/^#{1,6}\s/.test(trimmed)) {
            if (paragraph.length > 0) break;
            continue;
        }
        paragraph.push(trimmed.replace(/^[-*+]\s+/, ''));
    }
    return paragraph.join(' ').replace(/\s+/g, ' ').slice(0, 280);
}

function stringValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value.trim() : String(value).trim();
}

function listSkillFiles(dir: string, max = MAX_FILES): string[] {
    const files: string[] = [];
    const walk = (current: string, depth: number) => {
        if (files.length >= max || depth > MAX_SCAN_DEPTH) return;
        for (const entry of listDirectory(current)) {
            if (files.length >= max) return;
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full, depth + 1);
            } else if (entry.isFile()) {
                files.push(path.relative(dir, full).split(path.sep).join('/'));
            }
        }
    };
    walk(dir, 0);
    return files.sort();
}

function collectSkillDirs(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const found: string[] = [];
    const walk = (dir: string, depth: number) => {
        if (found.length >= MAX_SKILLS || depth > MAX_SCAN_DEPTH) return;
        const entries = listDirectory(dir);
        const hasSkillFile = entries.some(
            (entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md'
        );
        if (hasSkillFile) {
            found.push(dir);
            return;
        }
        for (const entry of entries) {
            if (found.length >= MAX_SKILLS) return;
            if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue;
            walk(path.join(dir, entry.name), depth + 1);
        }
    };
    walk(path.resolve(root), 0);
    return found;
}

function skillFileIn(dir: string): string | null {
    for (const entry of listDirectory(dir)) {
        if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
            return path.join(dir, entry.name);
        }
    }
    return null;
}

function enabledState(): Record<string, boolean> {
    const value = store.get(SKILL_STATE_KEY);
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, boolean>)
        : {};
}

function setEnabledState(id: string, enabled: boolean): void {
    const state = { ...enabledState(), [id]: enabled };
    store.set(SKILL_STATE_KEY, state);
}

function buildSkill(dir: string, root: SourceRoot): AgentSkill | null {
    const file = skillFileIn(dir);
    if (!file) return null;
    try {
        const raw = readTextFile(file);
        const parsed = parseFrontmatter(raw);
        const warnings = [...parsed.warnings];
        const fallbackName = path.basename(dir);
        const name = stringValue(parsed.data.name) || fallbackName;
        const description =
            stringValue(parsed.data.description) ||
            firstParagraph(parsed.body) ||
            'No description provided.';
        if (!stringValue(parsed.data.name)) {
            warnings.push('Missing name in frontmatter; using the folder name.');
        }
        if (!stringValue(parsed.data.description)) {
            warnings.push('Missing description in frontmatter.');
        }
        const id = stableId('skill', path.resolve(file));
        const builtin = root.scope === 'builtin';
        return {
            id,
            name,
            description,
            version: stringValue(parsed.data.version) || undefined,
            author: stringValue(parsed.data.author) || undefined,
            path: file,
            dir,
            sourceId: root.id,
            sourceLabel: root.label,
            sourceKind: root.kind as AgentSourceKind,
            // Built-in skills are the product's own guidance and cannot be
            // switched off, otherwise a user toggle could silently break tool routing.
            enabled: builtin ? true : enabledState()[id] ?? true,
            managed: root.scope === 'managed',
            builtin,
            size: Buffer.byteLength(raw, 'utf8'),
            preview: parsed.body.trim().replace(/\s+/g, ' ').slice(0, 260),
            files: listSkillFiles(dir),
            warnings,
        };
    } catch (error: any) {
        console.warn(`[Agents] Failed to read skill at ${file}:`, error);
        return null;
    }
}

export function listSources() {
    return skillRoots().map(sourceInfo);
}

export function listSkills(): AgentSkill[] {
    const skills: AgentSkill[] = [];
    for (const root of skillRoots()) {
        for (const dir of collectSkillDirs(root.path)) {
            const skill = buildSkill(dir, root);
            if (skill) skills.push(skill);
        }
    }
    const seen = new Set<string>();
    return skills
        .filter((skill) => {
            if (seen.has(skill.id)) return false;
            seen.add(skill.id);
            return true;
        })
        .sort((a, b) => {
            if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

export function getSkill(id: string): AgentSkill | null {
    return listSkills().find((skill) => skill.id === id) || null;
}

export function getEnabledSkills(): AgentSkill[] {
    return listSkills().filter((skill) => skill.enabled);
}

export function readSkill(id: string): AgentSkillDetail | null {
    const skill = getSkill(id);
    if (!skill) return null;
    return { ...skill, content: readTextFile(skill.path, 1024 * 1024) };
}

export function setSkillEnabled(id: string, enabled: boolean): boolean {
    const skill = getSkill(id);
    if (!skill || skill.builtin) return false;
    setEnabledState(id, enabled);
    return true;
}

export function removeSkill(id: string): boolean {
    const skill = getSkill(id);
    if (!skill || !skill.managed) return false;
    const root = managedSkillsRoot();
    if (!isInside(root, skill.dir) || path.resolve(skill.dir) === path.resolve(root)) {
        throw new Error('Refusing to delete a skill outside the managed directory.');
    }
    fs.rmSync(skill.dir, { recursive: true, force: true });
    return true;
}

function copySkillDirectory(sourceDir: string, managedRoot: string): string {
    const file = skillFileIn(sourceDir);
    if (!file) throw new Error('The selected folder does not contain a SKILL.md file.');
    const raw = readTextFile(file);
    const parsed = parseFrontmatter(raw);
    const name = stringValue(parsed.data.name) || path.basename(sourceDir);
    const destination = uniquePath(managedRoot, slugify(name));
    fs.cpSync(sourceDir, destination, {
        recursive: true,
        dereference: false,
        filter: (src) => {
            const base = path.basename(src);
            return base !== '.git' && base !== 'node_modules' && base !== 'dist' && base !== 'build';
        },
    });
    return destination;
}

/** Import every skill found in the chosen folder (supports both one skill and a collection). */
export function importSkillFolder(folder: string): number {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new Error('The selected path is not a directory.');
    }
    const root = managedSkillsRoot();
    ensureDir(root);
    const dirs = collectSkillDirs(folder);
    if (dirs.length === 0) {
        throw new Error('No SKILL.md found in the selected folder.');
    }
    let imported = 0;
    for (const dir of dirs.slice(0, 50)) {
        try {
            copySkillDirectory(dir, root);
            imported += 1;
        } catch (error) {
            console.warn(`[Agents] Failed to import skill ${dir}:`, error);
        }
    }
    if (imported === 0) throw new Error('No valid skill could be imported.');
    return imported;
}

export function importSkillFile(filePath: string): number {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('The selected path is not a file.');
    }
    if (path.extname(filePath).toLowerCase() !== '.md') {
        throw new Error('Select a Markdown skill file (SKILL.md).');
    }
    const root = managedSkillsRoot();
    ensureDir(root);
    const raw = readTextFile(filePath);
    const parsed = parseFrontmatter(raw);
    const baseName = path.basename(filePath, path.extname(filePath));
    const name =
        stringValue(parsed.data.name) ||
        (baseName.toLowerCase() === 'skill' ? path.basename(path.dirname(filePath)) : baseName);
    const destination = uniquePath(root, slugify(name));
    ensureDir(destination);
    fs.copyFileSync(filePath, path.join(destination, 'SKILL.md'));
    return 1;
}

export function skillCatalogPrompt(): string {
    const skills = getEnabledSkills();
    if (skills.length === 0) return '';
    const rows = skills
        .map(
            (skill) =>
                `- ${skill.name}${skill.builtin ? '（内置）' : ''}: ${skill.description} [来源: ${
                    skill.sourceLabel
                }]`
        )
        .join('\n');
    return [
        '可用 Skills（渐进式加载）：',
        rows,
        '',
        '当任务与某个 Skill 匹配时，先调用 read_skill 工具读取该 Skill 的完整说明，再按说明执行。',
        '不要编造 Skill 内容，也不要在未读取时声称已经使用。',
    ].join('\n');
}
