import { ipcRenderer } from 'electron'

window.ipcRenderer = ipcRenderer

window.api = {
    db: {
        executeSQL: (sql: string) => ipcRenderer.invoke('db:execute-sql', sql),
        importFile: (filePath: string) => ipcRenderer.invoke('db:import-file', filePath),
        getTables: () => ipcRenderer.invoke('db:get-tables'),
        getColumns: (tableName: string) => ipcRenderer.invoke('db:get-columns', tableName),
        updateTableDesc: (tableName: string, description: string) => ipcRenderer.invoke('db:update-table-desc', tableName, description),
        updateColumnDesc: (tableName: string, columnName: string, description: string) => ipcRenderer.invoke('db:update-column-desc', tableName, columnName, description),
        dropTable: (tableName: string) => ipcRenderer.invoke('db:drop-table', tableName),
    },
    sessions: {
        list: () => ipcRenderer.invoke('session:list'),
        create: (title?: string) => ipcRenderer.invoke('session:create', title),
        updateMessages: (sessionId: string, messages: any[]) => ipcRenderer.invoke('session:update-messages', sessionId, messages),
        rename: (sessionId: string, title: string) => ipcRenderer.invoke('session:rename', sessionId, title),
        delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
    },
    settings: {
        get: (key: string) => ipcRenderer.invoke('settings:get', key),
        set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    },
    utils: {
        getPathForFile: (file: File) => {
            // webUtils is available in Electron 22+
            const { webUtils } = require('electron');
            return webUtils.getPathForFile(file);
        }
    }
}

