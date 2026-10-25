/**
 * Minimal durable main-process logger.
 *
 * Windows GUI builds have no attached console, so startup failures would
 * otherwise be invisible. Logs are appended to <userData>/logs/main.log and
 * mirrored to the console during development.
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

function logFilePath(): string {
    return path.join(app.getPath('userData'), 'logs', 'main.log');
}

function serialize(error: unknown): string {
    if (!error) return '';
    if (error instanceof Error) return `${error.stack || error.message}`;
    return String(error);
}

export function logInfo(message: string, detail?: unknown): void {
    write('INFO', message, detail);
}

export function logError(message: string, error?: unknown): void {
    write('ERROR', message, error);
}

function write(level: 'INFO' | 'ERROR', message: string, detail?: unknown): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}${
        detail ? ` ${serialize(detail)}` : ''
    }\n`;
    try {
        const file = logFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, line, 'utf-8');
    } catch {
        // Never let logging break the app.
    }
    if (level === 'ERROR') {
        console.error(line.trimEnd());
    } else {
        console.log(line.trimEnd());
    }
}
