/**
 * Web Polyfill for Electron APIs
 * Allows the application to run in a browser for feature checks and extension validation.
 * Use LocalStorage for persistence and memory-based mocks for system features.
 */

if (typeof window !== 'undefined' && !window.api) {
    console.log('[Web Mode] Electron API not detected. Injecting Web Polyfills...');

    const MOCK_STORAGE_KEY = 'chat2excel_web_store';

    // Internal helper for LocalStorage state
    const getStore = () => {
        const data = localStorage.getItem(MOCK_STORAGE_KEY);
        return data ? JSON.parse(data) : { sessions: [], settings: { llm: {}, systemPrompt: "You are a data analysis assistant." } };
    };

    const saveStore = (data: any) => {
        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(data));
    };

    (window as any).api = {
        db: {
            importFile: async () => ({ success: true, tableName: 'mock_table' }),
            getTables: async () => ({
                success: true,
                data: [{ name: 'mock_sales_2024', displayName: 'Mock Sales Data' }]
            }),
            query: async () => ({
                success: true,
                data: [{ id: 1, product: 'Web Mock Item', price: 99.99 }],
                columns: ['id', 'product', 'price']
            }),
            getTableSchema: async () => ({ success: true, data: [{ column_name: 'id', column_type: 'INT' }] }),
            updateTableMetadata: async () => true,
            dropTable: async () => ({ success: true }),
        },
        sessions: {
            list: async () => getStore().sessions.sort((a: any, b: any) => b.timestamp - a.timestamp),
            create: async (title: string) => {
                const store = getStore();
                const newSession = {
                    id: crypto.randomUUID(),
                    title: title || 'New Chat',
                    messages: [],
                    timestamp: Date.now()
                };
                store.sessions.push(newSession);
                saveStore(store);
                return newSession;
            },
            updateMessages: async (id: string, messages: any[]) => {
                const store = getStore();
                const session = store.sessions.find((s: any) => s.id === id);
                if (session) {
                    session.messages = messages;
                    session.timestamp = Date.now();
                    saveStore(store);
                }
                return true;
            },
            rename: async (id: string, title: string) => {
                const store = getStore();
                const session = store.sessions.find((s: any) => s.id === id);
                if (session) {
                    session.title = title;
                    saveStore(store);
                }
                return true;
            },
            delete: async (id: string) => {
                const store = getStore();
                store.sessions = store.sessions.filter((s: any) => s.id !== id);
                saveStore(store);
                return true;
            }
        },
        settings: {
            get: async (key: string) => {
                const store = getStore();
                return store.settings[key];
            },
            set: async (key: string, value: any) => {
                const store = getStore();
                store.settings[key] = value;
                saveStore(store);
                return true;
            }
        },
        utils: {
            getPathForFile: (file: File) => file.name
        }
    };

    // ---- Chart / dashboard mocks (in-memory, seeded once per browser) ----

    const MOCK_CHART_STORE_KEY = 'chat2excel_web_charts';

    interface MockDefinition {
        id: string;
        title: string;
        description?: string;
        datasetIds: string[];
        query: { kind: 'sql'; sql: string; sqlHash: string; tables: string[] };
        spec: Record<string, any>;
        refresh: { mode: 'live' | 'snapshot'; auto: boolean; ttlSeconds: number };
        snapshot?: Record<string, any>;
        provenance?: Record<string, any>;
        fingerprint: string;
        version: number;
        createdAt: number;
        updatedAt: number;
        lastRefresh?: Record<string, any>;
    }

    interface MockDashboard {
        id: string;
        name: string;
        description?: string;
        items: { id: string; chartId: string; titleOverride?: string; layout?: Record<string, any> }[];
        filters: any[];
        autoRefresh?: { enabled: boolean; intervalSeconds: number };
        schemaVersion: number;
        createdAt: number;
        updatedAt: number;
    }

    const chartStore = () => {
        const raw = localStorage.getItem(MOCK_CHART_STORE_KEY);
        if (raw) {
            try {
                return JSON.parse(raw) as { charts: MockDefinition[]; dashboards: MockDashboard[] };
            } catch {
                /* fall through to seed */
            }
        }
        const seeded = { charts: [] as MockDefinition[], dashboards: [] as MockDashboard[] };
        localStorage.setItem(MOCK_CHART_STORE_KEY, JSON.stringify(seeded));
        return seeded;
    };

    const saveChartStore = (data: { charts: MockDefinition[]; dashboards: MockDashboard[] }) =>
        localStorage.setItem(MOCK_CHART_STORE_KEY, JSON.stringify(data));

    const MOCK_ROWS = [
        { region: '华东', total: 620 },
        { region: '华南', total: 480 },
        { region: '华北', total: 350 },
    ];
    const MOCK_COLUMNS = [
        { name: 'region', type: 'VARCHAR' },
        { name: 'total', type: 'DOUBLE' },
    ];
    const MOCK_SQL = 'SELECT region, SUM(amount) AS total FROM mock_sales_2024 GROUP BY region';

    const wrapSql = (sql: string, filters: any[]) => {
        const usable = (filters || []).filter((f: any) => f?.column === 'region' && f?.values?.length);
        if (!usable.length) return sql;
        const list = usable.flatMap((f: any) => f.values).map((v: any) => `'${String(v).replace(/'/g, "''")}'`);
        return `SELECT * FROM (${sql}) AS _filters_base WHERE "region" IN (${list.join(', ')})`;
    };

    const buildMockChart = (definition: MockDefinition, filters: any[]): any => {
        // Snapshot charts keep their frozen rows; filters only hit live ones
        // (mirrors electron/charts/refresh.ts).
        const sql =
            definition.refresh.mode === 'snapshot'
                ? definition.query.sql
                : wrapSql(definition.query.sql, filters);
        const rows = sql === MOCK_SQL ? MOCK_ROWS : MOCK_ROWS.filter((row) => row.region === '华东');
        const type = definition.spec?.chartType || 'bar';
        return {
            queryId: `web_${definition.id}`,
            chartId: definition.id,
            chartType: type,
            title: definition.title,
            columns: MOCK_COLUMNS,
            rows,
            encoding: { x: definition.spec?.x, y: definition.spec?.y || ['total'] },
            option: {},
            warnings: [],
            spec: definition.spec,
            kpis: type === 'kpi' ? [{ label: definition.title, value: 1450 }] : undefined,
            sql: definition.query.sql,
            tables: definition.query.tables,
            theme: definition.spec?.theme,
            rowCount: rows.length,
            generatedAt: Date.now(),
        };
    };

    (window as any).api.charts = {
        list: async () => chartStore().charts,
        get: async (chartId: string) => chartStore().charts.find((c) => c.id === chartId) || null,
        refresh: async (chartId: string, force?: boolean, filters?: any[]) => {
            const definition = chartStore().charts.find((c) => c.id === chartId);
            if (!definition) return { chartId, success: false, error: '图表不存在', refreshedAt: Date.now() };
            if (definition.refresh.mode === 'snapshot' && !force) {
                return {
                    chartId,
                    success: true,
                    cached: true,
                    chart: buildMockChart(definition, []),
                    definition,
                    refreshedAt: definition.snapshot?.capturedAt || Date.now(),
                };
            }
            return {
                chartId,
                success: true,
                cached: false,
                chart: buildMockChart(definition, filters || []),
                definition,
                refreshedAt: Date.now(),
            };
        },
        pin: async (input: any) => {
            const data = chartStore();
            const chart = input?.chart || {};
            const now = Date.now();
            const definition: MockDefinition = {
                id: `chart_${crypto.randomUUID()}`,
                title: input?.titleOverride || chart.title || '未命名图表',
                datasetIds: ['ds_mock'],
                query: { kind: 'sql', sql: chart.sql || MOCK_SQL, sqlHash: 'web', tables: ['mock_sales_2024'] },
                spec: chart.spec || { chartType: chart.chartType || 'bar', y: ['total'] },
                refresh: { mode: input?.mode || 'live', auto: !!input?.auto, ttlSeconds: 30 },
                snapshot: input?.mode === 'snapshot' ? { rows: MOCK_ROWS, columns: MOCK_COLUMNS, capturedAt: now } : undefined,
                provenance: input?.provenance,
                fingerprint: `web_${now}`,
                version: 1,
                createdAt: now,
                updatedAt: now,
                lastRefresh: { at: now, status: 'ok', rowCount: MOCK_ROWS.length },
            };
            data.charts.push(definition);
            let dashboard = input?.dashboardId
                ? data.dashboards.find((d) => d.id === input.dashboardId)
                : undefined;
            if (!dashboard) {
                dashboard = {
                    id: `dash_${crypto.randomUUID()}`,
                    name: input?.dashboardName || '新建仪表盘',
                    items: [],
                    filters: [],
                    schemaVersion: 1,
                    createdAt: now,
                    updatedAt: now,
                };
                data.dashboards.push(dashboard);
            }
            const item = { id: `item_${crypto.randomUUID()}`, chartId: definition.id };
            dashboard.items.push(item);
            dashboard.updatedAt = now;
            saveChartStore(data);
            return { success: true, data: { chart: definition, dashboard, item, reused: false } };
        },
        delete: async (chartId: string) => {
            const data = chartStore();
            data.charts = data.charts.filter((c) => c.id !== chartId);
            data.dashboards.forEach((d) => {
                d.items = d.items.filter((item) => item.chartId !== chartId);
            });
            saveChartStore(data);
            return { success: true };
        },
        update: async (input: any) => {
            const data = chartStore();
            const definition = data.charts.find((c) => c.id === input?.chartId);
            if (!definition) return { success: false, error: '图表不存在' };
            if (input?.spec) definition.spec = { ...definition.spec, ...input.spec };
            if (input?.title?.trim()) definition.title = input.title.trim();
            if (input?.sql?.trim()) definition.query.sql = input.sql.trim();
            definition.updatedAt = Date.now();
            definition.lastRefresh = { at: Date.now(), status: 'ok', rowCount: MOCK_ROWS.length };
            saveChartStore(data);
            return { success: true, data: { definition, chart: buildMockChart(definition, []) } };
        },
        rebuild: async (input: any) => {
            const data = chartStore();
            const definition = input?.chartId
                ? data.charts.find((c) => c.id === input.chartId)
                : undefined;
            if (definition) return buildMockChart(definition, []);
            if (!input?.sql) {
                return { success: false, error: '这个图表缺少查询元数据，无法重建。' };
            }
            return {
                chartType: input.spec?.chartType || 'bar',
                title: input.title || '未命名图表',
                columns: MOCK_COLUMNS,
                rows: MOCK_ROWS,
                encoding: { x: input.spec?.x, y: input.spec?.y || ['total'] },
                option: {},
                warnings: [],
                spec: input.spec || { chartType: 'bar', y: ['total'] },
                sql: input.sql,
                tables: ['mock_sales_2024'],
                rowCount: MOCK_ROWS.length,
            };
        },
    };

    (window as any).api.dashboards = {
        list: async () => chartStore().dashboards,
        get: async (dashboardId: string) =>
            chartStore().dashboards.find((d) => d.id === dashboardId) || null,
        create: async (args?: { name?: string; description?: string }) => {
            const data = chartStore();
            const now = Date.now();
            const dashboard: MockDashboard = {
                id: `dash_${crypto.randomUUID()}`,
                name: args?.name || '新建仪表盘',
                description: args?.description,
                items: [],
                filters: [],
                schemaVersion: 1,
                createdAt: now,
                updatedAt: now,
            };
            data.dashboards.push(dashboard);
            saveChartStore(data);
            return dashboard;
        },
        update: async (args: any) => {
            const data = chartStore();
            const dashboard = data.dashboards.find((d) => d.id === args?.dashboardId);
            if (!dashboard) return null;
            if (typeof args?.name === 'string') dashboard.name = args.name;
            if (typeof args?.description === 'string') dashboard.description = args.description;
            if (args?.autoRefresh) dashboard.autoRefresh = args.autoRefresh;
            if (Array.isArray(args?.filters)) dashboard.filters = args.filters;
            dashboard.updatedAt = Date.now();
            saveChartStore(data);
            return dashboard;
        },
        delete: async (dashboardId: string) => {
            const data = chartStore();
            data.dashboards = data.dashboards.filter((d) => d.id !== dashboardId);
            saveChartStore(data);
            return { success: true };
        },
        addChart: async (args: { dashboardId: string; chartId: string; titleOverride?: string }) => {
            const data = chartStore();
            const dashboard = data.dashboards.find((d) => d.id === args.dashboardId);
            if (!dashboard) throw new Error('仪表盘不存在');
            const existing = dashboard.items.find((item) => item.chartId === args.chartId);
            const item = existing || { id: `item_${crypto.randomUUID()}`, chartId: args.chartId, titleOverride: args.titleOverride };
            if (!existing) {
                dashboard.items.push(item);
                dashboard.updatedAt = Date.now();
                saveChartStore(data);
            }
            return { dashboard, item, created: !existing };
        },
        removeItem: async (args: { dashboardId: string; itemId: string }) => {
            const data = chartStore();
            const dashboard = data.dashboards.find((d) => d.id === args.dashboardId);
            if (!dashboard) return null;
            dashboard.items = dashboard.items.filter((item) => item.id !== args.itemId);
            dashboard.updatedAt = Date.now();
            saveChartStore(data);
            return dashboard;
        },
        updateLayout: async (args: { dashboardId: string; layout: any[] }) => {
            const data = chartStore();
            const dashboard = data.dashboards.find((d) => d.id === args.dashboardId);
            if (!dashboard) return null;
            dashboard.items = dashboard.items.map((item) => {
                const layout = args.layout.find((entry: any) => entry.itemId === item.id || entry.id === item.id);
                return layout ? { ...item, layout } : item;
            });
            saveChartStore(data);
            return dashboard;
        },
        refresh: async (dashboardId: string, _force?: boolean, filters?: any[]) => {
            const data = chartStore();
            const dashboard = data.dashboards.find((d) => d.id === dashboardId);
            const active = filters?.length ? filters : dashboard?.filters || [];
            const refreshedAt = Date.now();
            const items = await Promise.all(
                (dashboard?.items || []).map(async (item) => {
                    const definition = data.charts.find((c) => c.id === item.chartId);
                    if (!definition) {
                        return { chartId: item.chartId, success: false, error: '图表定义不存在', refreshedAt };
                    }
                    return {
                        chartId: item.chartId,
                        success: true,
                        cached: false,
                        chart: buildMockChart(definition, active),
                        definition,
                        refreshedAt,
                    };
                })
            );
            return { dashboardId, refreshedAt, items };
        },
    };

    (window as any).api.export = {
        chartCsv: async (args: { title?: string; rows: Record<string, unknown>[] }) => ({
            success: true,
            filePath: `C:\\mock\\${(args.title || 'chart').replace(/[\\/:*?"<>|]/g, '_')}.csv`,
            rowCount: args.rows?.length || 0,
        }),
        dashboardHtml: async (args: { name: string; sections: any[] }) => ({
            success: true,
            filePath: `C:\\mock\\${args.name}.html`,
            sections: args.sections?.length || 0,
        }),
    };

    // ---- Agent mock: scripted run that exercises the ask_user card ----
    // Mirrors the real runtime: every event carries a snapshot of the run's
    // messages, so the renderer never sees an empty list mid-run.

    const agentListeners = new Set<(event: any) => void>();
    const mockMessages: any[] = [];
    let mockSessionId = '';

    const emitAgentEvent = (event: any) => {
        agentListeners.forEach((listener) => {
            try {
                listener(event);
            } catch {
                /* listener errors must not break the mock run */
            }
        });
    };

    const emitWithSnapshot = (partial: Record<string, any>) => {
        emitAgentEvent({
            runId: 'web',
            sessionId: mockSessionId,
            messages: mockMessages.map((message) => ({ ...message })),
            ...partial,
        });
    };

    (window as any).api.agent = {
        run: async (options: { sessionId: string; input: string }) => {
            if (agentListeners.size === 0) {
                return { success: false, error: '浏览器预览模式暂不支持模型调用。' };
            }
            mockSessionId = options.sessionId;
            mockMessages.length = 0;
            mockMessages.push({
                id: `msg_${crypto.randomUUID()}`,
                role: 'user',
                content: options.input,
                timestamp: Date.now(),
            });
            setTimeout(() => {
                emitWithSnapshot({ type: 'update' });
                // The scripted ask_user pause: the assistant "calls" the tool,
                // the card renders from tool_calls + toolArgs.
                mockMessages.push({
                    id: `msg_${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: '',
                    timestamp: Date.now(),
                    tool_calls: [
                        {
                            id: 'web_ask_1',
                            type: 'function',
                            function: {
                                name: 'ask_user',
                                arguments: JSON.stringify({
                                    question: '这个报表的时间范围按哪个口径算？',
                                    options: [
                                        { label: '最近 7 天', description: '滚动一周' },
                                        { label: '本月', description: '自然月，从 1 号开始' },
                                        { label: '今年至今', description: '1 月 1 日到今天' },
                                    ],
                                }),
                            },
                        },
                    ],
                });
                emitWithSnapshot({
                    type: 'tool_start',
                    toolCallId: 'web_ask_1',
                    toolName: 'ask_user',
                    toolArgs: {
                        question: '这个报表的时间范围按哪个口径算？',
                        options: [
                            { label: '最近 7 天', description: '滚动一周' },
                            { label: '本月', description: '自然月，从 1 号开始' },
                            { label: '今年至今', description: '1 月 1 日到今天' },
                        ],
                        allowFreeText: true,
                    },
                });
            }, 300);
            return { runId: 'web', success: true };
        },
        abort: async () => {
            emitWithSnapshot({ type: 'end', aborted: true });
            return { success: true };
        },
        answerQuestion: async (args: { toolCallId: string; selected?: string[]; text?: string }) => {
            const summary = [
                args.selected?.length ? `用户选择：${args.selected.join('；')}` : '',
                args.text ? `用户补充：${args.text}` : '',
            ]
                .filter(Boolean)
                .join('\n');
            setTimeout(() => {
                // The tool result carries the persisted Q&A record.
                mockMessages.push({
                    id: `msg_${crypto.randomUUID()}`,
                    role: 'tool',
                    tool_call_id: args.toolCallId,
                    content: summary,
                    timestamp: Date.now(),
                    question: {
                        question: '这个报表的时间范围按哪个口径算？',
                        options: [
                            { label: '最近 7 天' },
                            { label: '本月' },
                            { label: '今年至今' },
                        ],
                        answer: { selected: args.selected, text: args.text },
                    },
                });
                mockMessages.push({
                    id: `msg_${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: `收到你的回答。\n${summary}`,
                    timestamp: Date.now(),
                });
                emitWithSnapshot({
                    type: 'tool_end',
                    toolCallId: args.toolCallId,
                    toolName: 'ask_user',
                });
                emitWithSnapshot({ type: 'end' });
            }, 200);
            return { success: true };
        },
        onEvent: (callback: (event: any) => void) => {
            agentListeners.add(callback);
            return () => {
                agentListeners.delete(callback);
            };
        },
    };
}

export { };
