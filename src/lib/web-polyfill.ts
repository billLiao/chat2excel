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
}

export { };
