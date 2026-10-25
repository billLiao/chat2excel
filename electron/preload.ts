import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
    db: {
        executeSQL: (sql: string) => ipcRenderer.invoke('db:execute-sql', sql),
        queryPage: (queryId: string, offset?: number, limit?: number) =>
            ipcRenderer.invoke('db:query-page', { queryId, offset, limit }),
        importFile: (filePath: string) => ipcRenderer.invoke('db:import-file', filePath),
        getTables: () => ipcRenderer.invoke('db:get-tables'),
        getDatasets: () => ipcRenderer.invoke('db:get-datasets'),
        getColumns: (tableName: string) => ipcRenderer.invoke('db:get-columns', tableName),
        updateTableDesc: (tableName: string, description: string) =>
            ipcRenderer.invoke('db:update-table-desc', tableName, description),
        updateColumnDesc: (tableName: string, columnName: string, description: string) =>
            ipcRenderer.invoke('db:update-column-desc', tableName, columnName, description),
        dropTable: (tableName: string) => ipcRenderer.invoke('db:drop-table', tableName),
    },
    sessions: {
        list: () => ipcRenderer.invoke('session:list'),
        create: (title?: string) => ipcRenderer.invoke('session:create', title),
        updateMessages: (sessionId: string, messages: any[]) =>
            ipcRenderer.invoke('session:update-messages', sessionId, messages),
        rename: (sessionId: string, title: string) =>
            ipcRenderer.invoke('session:rename', sessionId, title),
        delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
    },
    settings: {
        get: (key: string) => ipcRenderer.invoke('settings:get', key),
        set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    },
    utils: {
        getPathForFile: (file: File) => webUtils.getPathForFile(file),
    },
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
    },
    // Agent resources: skills, instruction files and MCP servers.
    agents: {
        overview: () => ipcRenderer.invoke('agents:overview'),
        rescan: () => ipcRenderer.invoke('agents:rescan'),
        skillContent: (id: string) => ipcRenderer.invoke('agents:skill-content', id),
        importSkill: (kind: 'folder' | 'file') => ipcRenderer.invoke('agents:import-skill', kind),
        setSkillEnabled: (id: string, enabled: boolean) =>
            ipcRenderer.invoke('agents:skill-enabled', { id, enabled }),
        deleteSkill: (id: string) => ipcRenderer.invoke('agents:delete-skill', id),
        instructionContent: (id: string) =>
            ipcRenderer.invoke('agents:instruction-content', id),
        setInstructionEnabled: (id: string, enabled: boolean) =>
            ipcRenderer.invoke('agents:instruction-enabled', { id, enabled }),
        saveInstruction: (id: string, content: string) =>
            ipcRenderer.invoke('agents:instruction-save', { id, content }),
        importInstruction: () => ipcRenderer.invoke('agents:import-instruction'),
        deleteInstruction: (id: string) =>
            ipcRenderer.invoke('agents:delete-instruction', id),
        setWorkspace: () => ipcRenderer.invoke('agents:workspace-set'),
        clearWorkspace: () => ipcRenderer.invoke('agents:workspace-clear'),
        mcpRefresh: () => ipcRenderer.invoke('agents:mcp-refresh'),
        setMcpEnabled: (id: string, enabled: boolean) =>
            ipcRenderer.invoke('agents:mcp-toggle', { id, enabled }),
        testMcp: (id: string) => ipcRenderer.invoke('agents:mcp-test', id),
        importMcp: () => ipcRenderer.invoke('agents:mcp-import'),
        removeMcp: (id: string) => ipcRenderer.invoke('agents:mcp-remove', id),
    },
    export: {
        query: (queryId: string, filename?: string) =>
            ipcRenderer.invoke('export:query', { queryId, filename }),
        data: (args: { data: any[]; format: string; filename: string; sheetName?: string }) =>
            ipcRenderer.invoke('export:data', args),
        chartCsv: (args: { filename?: string; title?: string; columns: { name: string }[]; rows: Record<string, unknown>[] }) =>
            ipcRenderer.invoke('export:chart-csv', args),
        dashboardHtml: (args: { name: string; filterNote?: string; sections: any[] }) =>
            ipcRenderer.invoke('export:dashboard-html', args),
    },
    agent: {
        run: (options: {
            sessionId: string;
            input: string;
            contextTables?: string[];
            modelName?: string;
        }) => ipcRenderer.invoke('agent:run', options),
        abort: (runId: string) => ipcRenderer.invoke('agent:abort', runId),
        answerQuestion: (args: { toolCallId: string; selected?: string[]; text?: string }) =>
            ipcRenderer.invoke('agent:answer-question', args),
        onEvent: (callback: (event: any) => void) => {
            const listener = (_event: unknown, payload: any) => callback(payload);
            ipcRenderer.on('agent:event', listener);
            return () => ipcRenderer.removeListener('agent:event', listener);
        },
    },
    charts: {
        list: () => ipcRenderer.invoke('charts:list'),
        get: (chartId: string) => ipcRenderer.invoke('charts:get', chartId),
        refresh: (chartId: string, force?: boolean, filters?: any[]) =>
            ipcRenderer.invoke('charts:refresh', { chartId, force, filters }),
        pin: (input: any) => ipcRenderer.invoke('charts:pin', input),
        delete: (chartId: string) => ipcRenderer.invoke('charts:delete', chartId),
        update: (input: any) => ipcRenderer.invoke('charts:update', input),
        rebuild: (input: any) => ipcRenderer.invoke('charts:rebuild', input),
    },
    dashboards: {
        list: () => ipcRenderer.invoke('dashboards:list'),
        get: (dashboardId: string) => ipcRenderer.invoke('dashboards:get', dashboardId),
        create: (args?: { name?: string; description?: string }) =>
            ipcRenderer.invoke('dashboards:create', args),
        update: (args: {
            dashboardId: string;
            name?: string;
            description?: string;
            autoRefresh?: { enabled: boolean; intervalSeconds: number };
            filters?: any[];
        }) => ipcRenderer.invoke('dashboards:update', args),
        delete: (dashboardId: string) =>
            ipcRenderer.invoke('dashboards:delete', dashboardId),
        addChart: (args: { dashboardId: string; chartId: string; titleOverride?: string }) =>
            ipcRenderer.invoke('dashboards:add-chart', args),
        removeItem: (args: { dashboardId: string; itemId: string }) =>
            ipcRenderer.invoke('dashboards:remove-item', args),
        updateLayout: (args: { dashboardId: string; layout: any[] }) =>
            ipcRenderer.invoke('dashboards:update-layout', args),
        refresh: (dashboardId: string, force?: boolean, filters?: any[]) =>
            ipcRenderer.invoke('dashboards:refresh', { dashboardId, force, filters }),
    },
}

contextBridge.exposeInMainWorld('api', api)
