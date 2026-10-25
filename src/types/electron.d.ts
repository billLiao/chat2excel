import type {
    AgentImportResult,
    AgentInstructionDetail,
    AgentOverview,
    AgentSkillDetail,
    McpServerInfo,
    McpTestResult,
} from '../lib/agents/types';
import type {
    ChartDefinition,
    ChartPayload,
    ChartRebuildInput,
    ChartRefreshItemResult,
    ChartUpdateInput,
    ChartUpdateResult,
    Dashboard,
    DashboardExportSection,
    DashboardFilter,
    DashboardRefreshResult,
    DatasetInfo,
    PinChartInput,
    PinChartResult,
} from '../lib/charts/types';

export { };

type AgentResponse<T = unknown> = {
    success: boolean;
    data?: T;
    error?: string;
    canceled?: boolean;
    imported?: number;
};

declare global {
    interface Window {
        api: {
            db: {
                executeSQL: (sql: string) => Promise<{ success: boolean; data?: any; error?: string; columns?: { name: string; type: string }[]; queryId?: string; rowCount?: number; truncated?: boolean; elapsedMs?: number }>;
                queryPage: (queryId: string, offset?: number, limit?: number) => Promise<{ success: boolean; data?: any; error?: string }>;
                importFile: (filePath: string) => Promise<{ success: boolean; tableName?: string; summary?: any; error?: string }>;
                getTables: () => Promise<{ success: boolean; data?: { name: string; displayName: string; description: string; datasetId?: string; importVersion?: number; rowCount?: number }[]; error?: string }>;
                getDatasets: () => Promise<{ success: boolean; data?: DatasetInfo[]; error?: string }>;
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
            export: {
                query: (queryId: string, filename?: string) => Promise<{ success: boolean; filePath?: string; rowCount?: number; canceled?: boolean; error?: string }>;
                data: (args: { data: any[]; format: string; filename: string; sheetName?: string }) =>
                    Promise<{ success: boolean; message?: string; error?: string }>;
                chartCsv: (args: { filename?: string; title?: string; columns: { name: string }[]; rows: Record<string, unknown>[] }) =>
                    Promise<{ success: boolean; filePath?: string; rowCount?: number; canceled?: boolean; error?: string }>;
                dashboardHtml: (args: { name: string; filterNote?: string; sections: DashboardExportSection[] }) =>
                    Promise<{ success: boolean; filePath?: string; sections?: number; canceled?: boolean; error?: string }>;
            };
            agents: {
                overview: () => Promise<AgentResponse<AgentOverview>>;
                rescan: () => Promise<AgentResponse<AgentOverview>>;
                skillContent: (id: string) => Promise<AgentResponse<AgentSkillDetail>>;
                importSkill: (kind: 'folder' | 'file') => Promise<AgentResponse<AgentOverview> & AgentImportResult>;
                setSkillEnabled: (id: string, enabled: boolean) => Promise<AgentResponse>;
                deleteSkill: (id: string) => Promise<AgentResponse>;
                instructionContent: (id: string) => Promise<AgentResponse<AgentInstructionDetail>>;
                setInstructionEnabled: (id: string, enabled: boolean) => Promise<AgentResponse>;
                saveInstruction: (id: string, content: string) => Promise<AgentResponse>;
                importInstruction: () => Promise<AgentResponse<AgentOverview> & AgentImportResult>;
                deleteInstruction: (id: string) => Promise<AgentResponse>;
                setWorkspace: () => Promise<AgentResponse<AgentOverview>>;
                clearWorkspace: () => Promise<AgentResponse<AgentOverview>>;
                mcpRefresh: () => Promise<AgentResponse<AgentOverview>>;
                setMcpEnabled: (id: string, enabled: boolean) => Promise<AgentResponse<AgentOverview>>;
                testMcp: (id: string) => Promise<McpTestResult>;
                importMcp: () => Promise<AgentResponse<AgentOverview> & AgentImportResult>;
                removeMcp: (id: string) => Promise<AgentResponse<AgentOverview>>;
            };
            agent: {
                run: (options: { sessionId: string; input: string; contextTables?: string[]; modelName?: string }) => Promise<{ runId?: string; success?: boolean; error?: string }>;
                abort: (runId: string) => Promise<{ success: boolean }>;
                answerQuestion: (args: { toolCallId: string; selected?: string[]; text?: string }) =>
                    Promise<{ success: boolean; error?: string }>;
                onEvent: (callback: (event: any) => void) => () => void;
            };
            charts: {
                list: () => Promise<ChartDefinition[]>;
                get: (chartId: string) => Promise<ChartDefinition | null>;
                refresh: (chartId: string, force?: boolean, filters?: DashboardFilter[]) => Promise<ChartRefreshItemResult>;
                pin: (input: PinChartInput) => Promise<{ success: boolean; data?: PinChartResult; error?: string }>;
                delete: (chartId: string) => Promise<{ success: boolean }>;
                update: (input: ChartUpdateInput) => Promise<{ success: boolean; data?: ChartUpdateResult; error?: string }>;
                rebuild: (input: ChartRebuildInput) => Promise<{ success: boolean; data?: ChartPayload; error?: string }>;
            };
            dashboards: {
                list: () => Promise<Dashboard[]>;
                get: (dashboardId: string) => Promise<Dashboard | null>;
                create: (args?: { name?: string; description?: string }) => Promise<Dashboard>;
                update: (args: {
                    dashboardId: string;
                    name?: string;
                    description?: string;
                    autoRefresh?: { enabled: boolean; intervalSeconds: number };
                    filters?: DashboardFilter[];
                }) => Promise<Dashboard | null>;
                delete: (dashboardId: string) => Promise<{ success: boolean }>;
                addChart: (args: { dashboardId: string; chartId: string; titleOverride?: string }) => Promise<{ dashboard: Dashboard; item: any; created: boolean }>;
                removeItem: (args: { dashboardId: string; itemId: string }) => Promise<Dashboard | null>;
                updateLayout: (args: { dashboardId: string; layout: any[] }) => Promise<Dashboard | null>;
                refresh: (dashboardId: string, force?: boolean, filters?: DashboardFilter[]) => Promise<DashboardRefreshResult>;
            };
        };
    }
}
