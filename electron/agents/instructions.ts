import fs from 'node:fs';
import path from 'node:path';
import type {
    AgentInstruction,
    AgentInstructionDetail,
    AgentSourceKind,
} from '../../src/lib/agents/types';
import { store } from '../store';
import {
    ensureDir,
    instructionRoots,
    isInside,
    listDirectory,
    managedInstructionsRoot,
    readTextFile,
    sourceInfo,
    stableId,
    uniquePath,
    type InstructionRoot,
} from './paths';

const INSTRUCTION_STATE_KEY = 'agentInstructionState';
const MAX_PROMPT_CHARS = 24_000;
const MAX_FILE_PROMPT_CHARS = 12_000;

function enabledState(): Record<string, boolean> {
    const value = store.get(INSTRUCTION_STATE_KEY);
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, boolean>)
        : {};
}

function setEnabledState(id: string, enabled: boolean): void {
    store.set(INSTRUCTION_STATE_KEY, { ...enabledState(), [id]: enabled });
}

function previewOf(content: string): string {
    return content
        .replace(/^---[\s\S]*?---\s*/, '')
        .replace(/[#*_>`-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
}

function buildInstruction(filePath: string, root: InstructionRoot): AgentInstruction | null {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return null;
        const content = readTextFile(filePath);
        const id = stableId('instruction', path.resolve(filePath));
        const base = path.basename(filePath);
        return {
            id,
            name: root.scope === 'managed' ? base.replace(/\.md$/i, '') : `${base} · ${root.label}`,
            path: filePath,
            sourceId: root.id,
            sourceLabel: root.label,
            sourceKind: root.kind as AgentSourceKind,
            enabled: enabledState()[id] ?? true,
            managed: root.scope === 'managed',
            size: Buffer.byteLength(content, 'utf8'),
            preview: previewOf(content),
        };
    } catch (error: any) {
        console.warn(`[Agents] Failed to read instructions at ${filePath}:`, error);
        return null;
    }
}

function managedInstructionFiles(): string[] {
    const root = managedInstructionsRoot();
    if (!fs.existsSync(root)) return [];
    return listDirectory(root)
        .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
        .map((entry) => path.join(root, entry.name));
}

export function listInstructionSources() {
    return instructionRoots().map((root) => sourceInfo(root));
}

export function listInstructions(): AgentInstruction[] {
    const instructions: AgentInstruction[] = [];
    for (const root of instructionRoots()) {
        if (root.file) {
            if (!fs.existsSync(root.path)) continue;
            const instruction = buildInstruction(root.path, root);
            if (instruction) instructions.push(instruction);
            continue;
        }
        for (const filePath of managedInstructionFiles()) {
            const instruction = buildInstruction(filePath, root);
            if (instruction) instructions.push(instruction);
        }
    }
    const seen = new Set<string>();
    return instructions
        .filter((instruction) => {
            if (seen.has(instruction.id)) return false;
            seen.add(instruction.id);
            return true;
        })
        .sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

export function getInstruction(id: string): AgentInstruction | null {
    return listInstructions().find((instruction) => instruction.id === id) || null;
}

export function readInstruction(id: string): AgentInstructionDetail | null {
    const instruction = getInstruction(id);
    if (!instruction) return null;
    return { ...instruction, content: readTextFile(instruction.path, 1024 * 1024) };
}

export function setInstructionEnabled(id: string, enabled: boolean): boolean {
    if (!getInstruction(id)) return false;
    setEnabledState(id, enabled);
    return true;
}

export function saveInstruction(id: string, content: string): boolean {
    const instruction = getInstruction(id);
    if (!instruction || !instruction.managed) return false;
    if (!isInside(managedInstructionsRoot(), instruction.path)) return false;
    if (content.length > 512 * 1024) {
        throw new Error('Instruction file is too large (max 512 KB).');
    }
    fs.writeFileSync(instruction.path, content, 'utf8');
    return true;
}

export function removeInstruction(id: string): boolean {
    const instruction = getInstruction(id);
    if (!instruction || !instruction.managed) return false;
    if (!isInside(managedInstructionsRoot(), instruction.path)) return false;
    fs.rmSync(instruction.path, { force: true });
    return true;
}

export function importInstruction(filePath: string): boolean {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error('The selected path is not a file.');
    }
    if (!/\.(md|txt)$/i.test(filePath)) {
        throw new Error('Select a Markdown or text instruction file.');
    }
    const root = managedInstructionsRoot();
    ensureDir(root);
    const base = path.basename(filePath);
    const destination = uniquePath(root, base);
    fs.copyFileSync(filePath, destination);
    return true;
}

interface EnabledInstruction {
    instruction: AgentInstruction;
    content: string;
    priority: number;
}

export function instructionPrompt(): string {
    const enabled: EnabledInstruction[] = [];
    for (const instruction of listInstructions()) {
        if (!instruction.enabled) continue;
        try {
            enabled.push({
                instruction,
                content: readTextFile(instruction.path),
                priority:
                    instruction.sourceKind === 'managed'
                        ? 0
                        : instruction.sourceKind === 'workspace'
                          ? 1
                          : 2,
            });
        } catch (error) {
            console.warn(`[Agents] Failed to include ${instruction.path}:`, error);
        }
    }
    if (enabled.length === 0) return '';

    enabled.sort((a, b) => a.priority - b.priority);
    const blocks: string[] = [
        '以下是用户启用的 Agent 指令文件（AGENTS.md / CLAUDE.md）。它们是用户提供的长期要求；' +
            '在不违反只读 SQL 与数据真实性约束的前提下优先遵守。',
    ];
    let remaining = MAX_PROMPT_CHARS;
    for (const item of enabled) {
        if (remaining <= 0) break;
        const limit = Math.min(MAX_FILE_PROMPT_CHARS, remaining);
        let content = item.content.trim();
        if (content.length > limit) {
            content = `${content.slice(0, limit)}\n\n[内容过长，已截断]`;
        }
        blocks.push(
            `<agent_instructions source="${item.instruction.name}" path="${item.instruction.path}">\n${content}\n</agent_instructions>`
        );
        remaining -= content.length;
    }
    return blocks.join('\n\n');
}
