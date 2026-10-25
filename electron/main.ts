import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import path from 'path'
import { db } from './db'
import {
    importWorkbook,
    sanitizeExportName,
    writeQueryExport,
} from './capabilities/excel'
import { abortAgentRun, answerAgentQuestion, startAgentRun, type AgentRunOptions } from './agent/runtime'
import {
    closeAllMcpConnections,
    getAgentOverview,
    getSkill,
    importInstruction,
    importMcpFile,
    importSkillFile,
    importSkillFolder,
    readInstruction,
    readSkill,
    refreshMcpConnections,
    removeInstruction,
    removeMcpServer,
    removeSkill,
    saveInstruction,
    setInstructionEnabled,
    setMcpEnabled,
    setSkillEnabled,
    setWorkspace,
    testMcpServer,
} from './agents'
import { getModels, setModels } from './settings'
import { logError, logInfo } from './logger'
import {
    createDashboard,
    deleteChart,
    deleteDashboard,
    getChart,
    getDashboard,
    listCharts,
    listDashboards,
    removeChartFromDashboard,
    addChartToDashboard,
    updateDashboard,
    updateDashboardLayout,
} from './charts/store'
import {
    invalidateChartCache,
    pinChart,
    rebuildChartPayload,
    refreshChart,
    refreshDashboard,
    updateChartSpec,
} from './charts/refresh'
import { buildChartCsv, buildDashboardHtml } from './charts/export'
import type {
    ChartRebuildInput,
    ChartUpdateInput,
    DashboardExportSection,
    DashboardFilter,
} from '../src/lib/charts/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// const __filename = fileURLToPath(import.meta.url)
import { store } from './store'
import { sessionManager } from './session'

// Register IPC handlers
ipcMain.handle('settings:get', (_, key) => {
    if (key === 'models') return getModels();
    return store.get(key);
});

ipcMain.handle('settings:set', (_, key, value) => {
    if (key === 'models') {
        setModels(value || []);
    } else {
        store.set(key, value);
    }
    return true;
});

/**
 * Renderer-facing SQL execution is read-only and row-capped. The legacy name
 * is kept so the data preview and SQL editor keep working.
 */
ipcMain.handle('db:execute-sql', async (_, sql: string) => {
    try {
        const preview = await db.queryPreview(sql, { maxRows: 1000, timeoutMs: 30_000 });
        return {
            success: true,
            data: preview.rows,
            columns: preview.columns,
            queryId: preview.queryId,
            rowCount: preview.rowCount,
            truncated: preview.truncated,
            elapsedMs: preview.elapsedMs,
        };
    } catch (error: any) {
        console.error('SQL Execution Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:query-page', async (_, args: { queryId: string; offset?: number; limit?: number }) => {
    try {
        const page = db.getQueryPage(args.queryId, args.offset || 0, args.limit || 100);
        return { success: true, data: page };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:import-file', async (_, filePath: string) => {
    try {
        console.log('Importing file:', filePath);
        const summary = await importWorkbook(filePath);
        return {
            success: true,
            tableName: summary.sheets[0].tableName,
            summary,
        };
    } catch (error: any) {
        console.error('File Import Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:get-tables', async () => {
    try {
        const tables = await db.getTables();
        return { success: true, data: tables };
    } catch (error: any) {
        console.error('Get Tables Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:get-datasets', async () => {
    try {
        return { success: true, data: await db.getDatasets() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:get-columns', async (_, tableName: string) => {
    try {
        const columns = await db.getTableColumns(tableName);
        return { success: true, data: columns };
    } catch (error: any) {
        console.error('Get Columns Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:update-table-desc', async (_, tableName: string, description: string) => {
    try {
        await db.updateTableDescription(tableName, description);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:update-column-desc', async (_, tableName: string, columnName: string, description: string) => {
    try {
        await db.updateColumnDescription(tableName, columnName, description);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:drop-table', async (_, tableName: string) => {
    try {
        await db.dropTable(tableName);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// --- Chart & Dashboard Handlers ---
ipcMain.handle('charts:list', () => listCharts());
ipcMain.handle('charts:get', (_, chartId: string) => getChart(chartId));
ipcMain.handle('charts:refresh', (_, args: { chartId: string; force?: boolean; filters?: DashboardFilter[] }) =>
    refreshChart(args.chartId, { force: args.force, filters: args.filters })
);
ipcMain.handle('charts:pin', async (_, input: Parameters<typeof pinChart>[0]) => {
    try {
        return { success: true, data: await pinChart(input) };
    } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
    }
});
ipcMain.handle('charts:delete', (_, chartId: string) => {
    invalidateChartCache(chartId);
    return { success: deleteChart(chartId) };
});
ipcMain.handle('charts:update', async (_, input: ChartUpdateInput) => {
    try {
        return { success: true, data: await updateChartSpec(input) };
    } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
    }
});
ipcMain.handle('charts:rebuild', async (_, input: ChartRebuildInput) => {
    try {
        return { success: true, data: await rebuildChartPayload(input) };
    } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
    }
});

ipcMain.handle('dashboards:list', () => listDashboards());
ipcMain.handle('dashboards:get', (_, dashboardId: string) => getDashboard(dashboardId));
ipcMain.handle('dashboards:create', (_, args?: { name?: string; description?: string }) =>
    createDashboard(args?.name, args?.description)
);
/** Keep only well-formed dashboard filters; the renderer sends edited drafts. */
function sanitizeDashboardFilters(input: unknown): DashboardFilter[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const filters: DashboardFilter[] = [];
    for (const raw of input.slice(0, 10)) {
        if (!raw || typeof raw !== 'object') continue;
        const candidate = raw as Record<string, unknown>;
        const kind = candidate.kind === 'date-range' || candidate.kind === 'category' ? candidate.kind : null;
        if (!kind || typeof candidate.column !== 'string' || !candidate.column.trim()) continue;
        const filter: DashboardFilter = {
            id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `flt_${Math.random().toString(36).slice(2, 10)}`,
            kind,
            column: candidate.column.trim(),
        };
        if (kind === 'date-range') {
            if (typeof candidate.from === 'string' && candidate.from) filter.from = candidate.from;
            if (typeof candidate.to === 'string' && candidate.to) filter.to = candidate.to;
            if (!filter.from && !filter.to) continue;
        } else if (Array.isArray(candidate.values)) {
            const values = candidate.values
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
                .slice(0, 100);
            if (values.length === 0) continue;
            filter.values = values;
        } else {
            continue;
        }
        filters.push(filter);
    }
    return filters;
}

ipcMain.handle('dashboards:update', (_, args: {
    dashboardId: string;
    name?: string;
    description?: string;
    autoRefresh?: { enabled: boolean; intervalSeconds: number };
    filters?: unknown;
}) => {
    // Only forward fields that were explicitly provided; undefined must not
    // overwrite the stored name/description.
    const patch: {
        name?: string;
        description?: string;
        autoRefresh?: { enabled: boolean; intervalSeconds: number };
        filters?: DashboardFilter[];
    } = {};
    if (typeof args.name === 'string') patch.name = args.name;
    if (typeof args.description === 'string') patch.description = args.description;
    if (args.autoRefresh) patch.autoRefresh = args.autoRefresh;
    const filters = sanitizeDashboardFilters(args.filters);
    if (filters) patch.filters = filters;
    return updateDashboard(args.dashboardId, patch);
});
ipcMain.handle('dashboards:delete', (_, dashboardId: string) => ({
    success: deleteDashboard(dashboardId),
}));
ipcMain.handle('dashboards:add-chart', (_, args: { dashboardId: string; chartId: string; titleOverride?: string }) =>
    addChartToDashboard(args.dashboardId, args.chartId, {
        titleOverride: args.titleOverride,
    })
);
ipcMain.handle('dashboards:remove-item', (_, args: { dashboardId: string; itemId: string }) =>
    removeChartFromDashboard(args.dashboardId, args.itemId)
);
ipcMain.handle('dashboards:update-layout', (_, args: { dashboardId: string; layout: any[] }) =>
    updateDashboardLayout(args.dashboardId, args.layout)
);
ipcMain.handle('dashboards:refresh', (_, args: { dashboardId: string; force?: boolean; filters?: DashboardFilter[] }) =>
    refreshDashboard(args.dashboardId, { force: args.force, filters: args.filters })
);

// --- Session Handlers ---
ipcMain.handle('session:list', () => sessionManager.getSessions());
ipcMain.handle('session:create', (_, title) => sessionManager.createSession(title));
ipcMain.handle('session:update-messages', (_, sessionId, messages) => sessionManager.updateSessionMessages(sessionId, messages));
ipcMain.handle('session:rename', (_, sessionId, title) => sessionManager.renameSession(sessionId, title));
ipcMain.handle('session:delete', (_, sessionId) => sessionManager.deleteSession(sessionId));

// --- Agent Handlers ---
ipcMain.handle('agent:run', async (event, options: AgentRunOptions) => {
    try {
        const sender = event.sender;
        return await startAgentRun(options, (payload) => {
            if (!sender.isDestroyed()) {
                sender.send('agent:event', payload);
            }
        });
    } catch (error: any) {
        console.error('Agent Run Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agent:abort', (_, runId: string) => {
    return { success: abortAgentRun(runId) };
});

// Renderer → ask_user resolution. toolCallId identifies the pending question.
ipcMain.handle('agent:answer-question', (_, args: { toolCallId: string; selected?: string[]; text?: string }) => {
    const answered = answerAgentQuestion(args?.toolCallId || '', {
        selected: Array.isArray(args?.selected) ? args.selected.filter((v) => typeof v === 'string') : undefined,
        text: typeof args?.text === 'string' ? args.text : undefined,
    });
    return {
        success: answered,
        error: answered ? undefined : '这个问题已经不在等待状态（可能已超时或被回答）。',
    };
});

// --- Agent Resources: Skills, Instructions, MCP ---
function agentOverviewResponse() {
    return { success: true, data: getAgentOverview() };
}

ipcMain.handle('agents:overview', () => {
    try {
        return agentOverviewResponse();
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:rescan', () => {
    try {
        return agentOverviewResponse();
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:skill-content', (_, id: string) => {
    try {
        const detail = readSkill(id);
        if (!detail) return { success: false, error: 'Skill not found.' };
        return { success: true, data: detail };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:import-skill', async (_, kind: 'folder' | 'file') => {
    try {
        const options = kind === 'file'
            ? {
                  title: 'Import SKILL.md',
                  properties: ['openFile'],
                  filters: [{ name: 'Markdown', extensions: ['md'] }],
              }
            : { title: 'Import skill folder', properties: ['openDirectory'] };
        const result = win
            ? await dialog.showOpenDialog(win, options as any)
            : await dialog.showOpenDialog(options as any);
        const selected = result.filePaths?.[0];
        if (result.canceled || !selected) return { success: false, canceled: true };
        const imported = kind === 'file' ? importSkillFile(selected) : importSkillFolder(selected);
        return { success: true, imported, data: getAgentOverview() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:skill-enabled', (_, args: { id: string; enabled: boolean }) => {
    try {
        const skill = getSkill(args.id);
        if (!skill) {
            return { success: false, error: 'Skill not found.' };
        }
        if (skill.builtin) {
            return { success: false, error: 'Built-in skills are always enabled.' };
        }
        if (!setSkillEnabled(args.id, args.enabled)) {
            return { success: false, error: 'The skill state could not be changed.' };
        }
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:delete-skill', (_, id: string) => {
    try {
        if (!removeSkill(id)) {
            return { success: false, error: 'Only imported skills can be deleted.' };
        }
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:instruction-content', (_, id: string) => {
    try {
        const detail = readInstruction(id);
        if (!detail) return { success: false, error: 'Instruction file not found.' };
        return { success: true, data: detail };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:instruction-enabled', (_, args: { id: string; enabled: boolean }) => {
    try {
        if (!setInstructionEnabled(args.id, args.enabled)) {
            return { success: false, error: 'Instruction file not found.' };
        }
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:instruction-save', (_, args: { id: string; content: string }) => {
    try {
        if (!saveInstruction(args.id, args.content)) {
            return { success: false, error: 'Only imported instruction files can be edited.' };
        }
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:import-instruction', async () => {
    try {
        const options = {
            title: 'Import AGENTS.md',
            properties: ['openFile'],
            filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options as any)
            : await dialog.showOpenDialog(options as any);
        const selected = result.filePaths?.[0];
        if (result.canceled || !selected) return { success: false, canceled: true };
        importInstruction(selected);
        return { success: true, data: getAgentOverview() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:delete-instruction', (_, id: string) => {
    try {
        if (!removeInstruction(id)) {
            return { success: false, error: 'Only imported instruction files can be deleted.' };
        }
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:workspace-set', async () => {
    try {
        const options = {
            title: 'Select an agent workspace',
            properties: ['openDirectory'],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options as any)
            : await dialog.showOpenDialog(options as any);
        const selected = result.filePaths?.[0];
        if (result.canceled || !selected) return { success: false, canceled: true };
        setWorkspace(selected);
        return { success: true, data: getAgentOverview() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:workspace-clear', () => {
    try {
        setWorkspace(null);
        return { success: true, data: getAgentOverview() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:mcp-refresh', async () => {
    try {
        await refreshMcpConnections();
        return agentOverviewResponse();
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:mcp-toggle', async (_, args: { id: string; enabled: boolean }) => {
    try {
        if (!(await setMcpEnabled(args.id, args.enabled))) {
            return { success: false, error: 'MCP server not found.' };
        }
        return agentOverviewResponse();
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:mcp-test', async (_, id: string) => {
    try {
        const server = await testMcpServer(id);
        return { success: true, server };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:mcp-import', async () => {
    try {
        const options = {
            title: 'Import MCP configuration',
            properties: ['openFile'],
            filters: [{ name: 'MCP config', extensions: ['json', 'toml'] }],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options as any)
            : await dialog.showOpenDialog(options as any);
        const selected = result.filePaths?.[0];
        if (result.canceled || !selected) return { success: false, canceled: true };
        const imported = await importMcpFile(selected);
        return { success: true, imported, data: getAgentOverview() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('agents:mcp-remove', async (_, id: string) => {
    try {
        if (!(await removeMcpServer(id))) {
            return { success: false, error: 'Only imported MCP servers can be removed.' };
        }
        return agentOverviewResponse();
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// --- Export Handlers ---
ipcMain.handle('export:query', async (_, args: { queryId: string; filename?: string }) => {
    try {
        const artifact = db.getQueryArtifact(args.queryId);
        const safeName = sanitizeExportName(args.filename);
        const options = {
            defaultPath: `${safeName}.xlsx`,
            filters: [
                { name: 'Excel', extensions: ['xlsx'] },
                { name: 'CSV', extensions: ['csv'] },
            ],
        };
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }

        const exported = await writeQueryExport(artifact, result.filePath);
        return {
            success: true,
            filePath: exported.filePath,
            rowCount: exported.rowCount,
            format: exported.format,
        };
    } catch (error: any) {
        console.error('Export Error:', error);
        return { success: false, error: error.message };
    }
});

/** @deprecated Renderer-provided data export; use export:query instead. */
ipcMain.handle('export:data', async (_, args: { data: any[]; format: string; filename: string; sheetName?: string }) => {
    try {
        console.log('Legacy export request:', args?.filename);
        return { success: false, error: 'Use export:query with a queryId.' };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

const MAX_EXPORT_CSV_ROWS = 50_000;

ipcMain.handle('export:chart-csv', async (_, args: {
    filename?: string;
    title?: string;
    columns: { name: string }[];
    rows: Record<string, unknown>[];
}) => {
    try {
        const columns = Array.isArray(args?.columns) ? args.columns : [];
        const rows = Array.isArray(args?.rows) ? args.rows.slice(0, MAX_EXPORT_CSV_ROWS) : [];
        if (columns.length === 0) throw new Error('这个图表没有可导出的列。');
        const safeName = sanitizeExportName(args.title || args.filename);
        const options = {
            defaultPath: `${safeName}.csv`,
            filters: [{ name: 'CSV', extensions: ['csv'] }],
        };
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }
        await writeFile(result.filePath, buildChartCsv(columns as any, rows), 'utf-8');
        return { success: true, filePath: result.filePath, rowCount: rows.length };
    } catch (error: any) {
        console.error('Chart CSV Export Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('export:dashboard-html', async (_, args: {
    name: string;
    filterNote?: string;
    sections: DashboardExportSection[];
}) => {
    try {
        const sections = Array.isArray(args?.sections) ? args.sections.slice(0, 60) : [];
        if (sections.length === 0) throw new Error('这个仪表盘没有可导出的图表。');
        const safeName = sanitizeExportName(args.name);
        const options = {
            defaultPath: `${safeName}.html`,
            filters: [{ name: 'HTML', extensions: ['html'] }],
        };
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }
        const html = buildDashboardHtml(
            { name: args.name || '仪表盘', exportedAt: Date.now(), filterNote: args.filterNote },
            sections
        );
        await writeFile(result.filePath, html, 'utf-8');
        return { success: true, filePath: result.filePath, sections: sections.length };
    } catch (error: any) {
        console.error('Dashboard HTML Export Error:', error);
        return { success: false, error: error.message };
    }
});

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC || '', 'icon.png'),
        frame: false, // Frameless window
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: true,
        },
    })

    // The renderer is a local single-page app: never allow it to navigate away
    // or open new Electron windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
        if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return;
        if (url.startsWith('file://')) return;
        event.preventDefault();
    });

    // Window controls IPC
    ipcMain.handle('window:minimize', () => win?.minimize());
    ipcMain.handle('window:maximize', () => {
        if (win?.isMaximized()) {
            win.unmaximize();
        } else {
            win?.maximize();
        }
    });
    ipcMain.handle('window:close', () => win?.close());

    // Hide top menu bar
    win.setMenu(null);

    win.webContents.on('did-fail-load', (_event, code, description, url) => {
        logError(`Renderer failed to load ${url} (${code}): ${description}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        logError('Renderer process gone', details);
    });

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    // Register shortcut to toggle DevTools (development only)
    win.webContents.on('before-input-event', (_, input) => {
        if (!app.isPackaged && input.control && input.key.toLowerCase() === 'i') {
            win?.webContents.toggleDevTools();
        }
    });

    if (VITE_DEV_SERVER_URL) {
        console.log('Loading URL:', VITE_DEV_SERVER_URL);
        const load = () => {
            win?.loadURL(VITE_DEV_SERVER_URL).catch((e) => {
                console.error('Failed to load URL, retrying in 1s:', e.message);
                setTimeout(load, 1000);
            });
        };
        load();
    } else {
        // win.loadFile('dist/index.html')
        win.loadFile(path.join(process.env.DIST || '', 'index.html'))
    }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('before-quit', () => {
    void closeAllMcpConnections()
})

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

process.on('uncaughtException', (error) => {
    logError('Uncaught exception in main process', error);
});
process.on('unhandledRejection', (reason) => {
    logError('Unhandled rejection in main process', reason);
});

app.whenReady().then(async () => {
    try {
        logInfo(`Starting Chat2Excel ${app.getVersion()} (Electron ${process.versions.electron})`);
        // The app never needs camera/mic/geolocation/etc.
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
            callback(false);
        });
        app.on('web-contents-created', (_event, contents) => {
            contents.on('will-attach-webview', (event) => event.preventDefault());
        });

        await db.init();
        logInfo('Database initialized');
        createWindow();
    } catch (error) {
        logError('Failed to initialize application', error);
        app.quit();
    }
})
