import type { AgentOverview } from '../../src/lib/agents/types';
import { getWorkspace } from './paths';
import {
    getEnabledSkills,
    listSkills,
    listSources as listSkillSources,
    skillCatalogPrompt,
} from './skills';
import {
    instructionPrompt,
    listInstructionSources,
    listInstructions,
} from './instructions';
import { listMcpServers } from './mcp';

export function getAgentOverview(): AgentOverview {
    const skills = listSkills();
    const instructions = listInstructions();
    const mcp = listMcpServers();
    const skillsEnabled = skills.filter((skill) => skill.enabled).length;
    const instructionsEnabled = instructions.filter((item) => item.enabled).length;
    const mcpEnabled = mcp.servers.filter((server) => server.enabled).length;
    const mcpConnected = mcp.servers.filter((server) => server.status === 'connected').length;
    const mcpTools = mcp.servers.reduce((sum, server) => sum + server.tools.length, 0);

    return {
        skills,
        instructions,
        mcpServers: mcp.servers,
        sources: {
            skills: listSkillSources(),
            instructions: listInstructionSources(),
            mcp: mcp.sources,
        },
        workspace: getWorkspace(),
        stats: {
            skills: skills.length,
            skillsEnabled,
            instructions: instructions.length,
            instructionsEnabled,
            mcpServers: mcp.servers.length,
            mcpEnabled,
            mcpConnected,
            mcpTools,
        },
        warnings: mcp.warnings,
    };
}

export function agentPromptExtras(): { instructions: string; skills: string } {
    return {
        instructions: instructionPrompt(),
        skills: skillCatalogPrompt(),
    };
}

export function enabledSkillCount(): number {
    return getEnabledSkills().length;
}

export {
    getEnabledSkills,
    listSkillSources,
    listSkills,
    instructionPrompt,
    skillCatalogPrompt,
};
export {
    listInstructions,
    listInstructionSources,
    readInstruction,
    setInstructionEnabled,
    saveInstruction,
    removeInstruction,
    importInstruction,
} from './instructions';
export {
    getSkill,
    importSkillFile,
    importSkillFolder,
    readSkill,
    removeSkill,
    setSkillEnabled,
} from './skills';
export {
    closeAllMcpConnections,
    importMcpFile,
    listMcpServers,
    mcpAgentTools,
    refreshMcpConnections,
    removeMcpServer,
    setMcpEnabled,
    testMcpServer,
} from './mcp';
export { getWorkspace, setWorkspace } from './paths';
