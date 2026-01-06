import Store from 'electron-store';

interface UserSettings {
    theme: 'light' | 'dark' | 'system';
    language: 'en' | 'zh';
    models: {
        name: string;
        baseUrl: string;
        apiKey: string;
        modelId: string;
    }[];
    activeModelId?: string;
    systemPrompt?: string;
}

const schema = {
    theme: {
        type: 'string',
        enum: ['light', 'dark', 'system'],
        default: 'system'
    },
    language: {
        type: 'string',
        enum: ['en', 'zh'],
        default: 'en'
    },
    models: {
        type: 'array',
        default: [],
        items: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                baseUrl: { type: 'string' },
                apiKey: { type: 'string' },
                modelId: { type: 'string' }
            }
        }
    },
    activeModelId: {
        type: 'string'
    },
    systemPrompt: {
        type: 'string'
    }
} as const;

export const store = new Store<UserSettings>({ schema: schema as any });
