/**
 * Model settings with OS-backed secret storage.
 *
 * API keys are encrypted with Electron's safeStorage before they touch
 * electron-store. If the OS keychain is unavailable (for example on a bare
 * Linux CI box), the key is kept as-is so the app still works, but the settings
 * payload never leaves the main process.
 */

import { safeStorage } from 'electron';
import { store } from './store';

export interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
}

const SECRET_PREFIX = 'safe:';

function encryptSecret(value: string): string {
    if (!value || value.startsWith(SECRET_PREFIX)) return value;
    if (!safeStorage.isEncryptionAvailable()) return value;
    try {
        return SECRET_PREFIX + safeStorage.encryptString(value).toString('base64');
    } catch (error) {
        console.error('[Settings] Failed to encrypt API key:', error);
        return value;
    }
}

function decryptSecret(value: string): string {
    if (!value || !value.startsWith(SECRET_PREFIX)) return value;
    try {
        return safeStorage.decryptString(
            Buffer.from(value.slice(SECRET_PREFIX.length), 'base64')
        );
    } catch (error) {
        console.error('[Settings] Failed to decrypt API key:', error);
        return '';
    }
}

export function getModels(): ModelConfig[] {
    const models = (store.get('models') || []) as ModelConfig[];
    return models.map((model) => ({
        ...model,
        apiKey: decryptSecret(model.apiKey),
    }));
}

export function setModels(models: ModelConfig[]): void {
    const safeModels = (Array.isArray(models) ? models : []).map((model) => ({
        ...model,
        apiKey: encryptSecret(model.apiKey || ''),
    }));
    store.set('models', safeModels as any);
}
