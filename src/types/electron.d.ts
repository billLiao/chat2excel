export { };

declare global {
    interface Window {
        ipcRenderer: import('electron').IpcRenderer;
        api: {
            db: {
                executeSQL: (sql: string) => Promise<{ success: boolean; data?: any; error?: string }>;
                importFile: (filePath: string) => Promise<{ success: boolean; tableName?: string; error?: string }>;
                getTables: () => Promise<{ success: boolean; data?: { name: string; displayName: string; description: string }[]; error?: string }>;
                getColumns: (tableName: string) => Promise<{ success: boolean; data?: { name: string; type: string; description: string }[]; error?: string }>;
                updateTableDesc: (tableName: string, description: string) => Promise<{ success: boolean; error?: string }>;
                updateColumnDesc: (tableName: string, columnName: string, description: string) => Promise<{ success: boolean; error?: string }>;
                dropTable: (tableName: string) => Promise<{ success: boolean; error?: string }>;
            };
            sessions: {
                list: () => Promise<any[]>;
                create: (title?: string) => Promise<any>;
                updateMessages: (sessionId: string, messages: any[]) => Promise<boolean>;
                rename: (sessionId: string, title: string) => Promise<boolean>;
                delete: (sessionId: string) => Promise<boolean>;
            };
            settings: {
                get: <T = any>(key: string) => Promise<T>;
                set: (key: string, value: any) => Promise<boolean>;
            };
            utils: {
                getPathForFile: (file: File) => string;
            };
            window: {
                minimize: () => Promise<void>;
                maximize: () => Promise<void>;
                close: () => Promise<void>;
            };
        };
    }
}
