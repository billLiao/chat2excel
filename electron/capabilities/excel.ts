/**
 * Excel / CSV export capability layer.
 *
 * The save dialog (user-initiated) and the agent tool (app-managed folder)
 * share this implementation so formatting, encoding and formula-injection
 * handling cannot drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import ExcelJS from 'exceljs';
import { db } from '../db';
import type { ImportSummary } from '../importer';
import type { QueryArtifact } from '../agent/result-store';

export type ExportFormat = 'xlsx' | 'csv';

export interface ExportFileResult {
    filePath: string;
    fileName: string;
    format: ExportFormat;
    rowCount: number;
}

export interface ExportQueryOptions {
    filename?: string;
    format?: ExportFormat;
    /** Defaults to the app-managed exports folder. */
    directory?: string;
}

const MAX_FILENAME_LENGTH = 80;
const MAX_COLUMN_WIDTH = 45;

export function exportDirectory(): string {
    return path.join(app.getPath('userData'), 'exports');
}

/**
 * Import an Excel/CSV workbook chosen by the user. The agent never calls this:
 * ingestion stays a user-driven action in the renderer.
 */
export async function importWorkbook(filePath: string): Promise<ImportSummary> {
    return db.importFileDetailed(filePath);
}

export function sanitizeExportName(raw?: string, fallback = 'chat2excel-export'): string {
    const cleaned = (raw || '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/^[.\-_\s]+|[.\-_\s]+$/g, '')
        .trim();
    return (cleaned || fallback).slice(0, MAX_FILENAME_LENGTH);
}

function formatFromPath(filePath: string, fallback: ExportFormat = 'xlsx'): ExportFormat {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv') return 'csv';
    if (ext === '.xlsx') return 'xlsx';
    return fallback;
}

function cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Spreadsheet apps execute strings that start with =, +, - or @ when a CSV is
 * opened. Prefix a single quote so user data can never become a formula.
 */
function neutralizeFormula(text: string): string {
    if (/^[=+@]/.test(text) || /^-[A-Za-z(]/.test(text)) {
        return `'${text}`;
    }
    return text;
}

function csvCell(value: unknown): string {
    const text = neutralizeFormula(cellText(value));
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(artifact: QueryArtifact, filePath: string): void {
    const lines: string[] = [];
    lines.push(artifact.columns.map((column) => csvCell(column.name)).join(','));
    for (const row of artifact.rows) {
        lines.push(row.map(csvCell).join(','));
    }
    fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf-8');
}

async function writeXlsx(artifact: QueryArtifact, filePath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Chat2Excel';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Result', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    const headers = artifact.columns.map((column) => column.name);
    if (headers.length === 0) headers.push('Result');
    worksheet.addRow(headers);
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' },
    };
    worksheet.getRow(1).alignment = { vertical: 'middle' };
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
    };

    for (const row of artifact.rows) {
        worksheet.addRow(row.map((value) => (value === undefined ? null : value)));
    }

    artifact.columns.forEach((column, index) => {
        let width = column.name.length + 4;
        const sample = artifact.rows.slice(0, 200);
        for (const row of sample) {
            width = Math.max(width, cellText(row[index]).length + 2);
        }
        worksheet.getColumn(index + 1).width = Math.min(MAX_COLUMN_WIDTH, Math.max(12, width));
    });

    await workbook.xlsx.writeFile(filePath);
}

/**
 * Write an artifact to an explicit path. The format is inferred from the file
 * extension so the save dialog can honor a user-typed ".csv".
 */
export async function writeQueryExport(
    artifact: QueryArtifact,
    filePath: string,
    format?: ExportFormat
): Promise<ExportFileResult> {
    const resolvedFormat = format || formatFromPath(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (resolvedFormat === 'csv') {
        writeCsv(artifact, filePath);
    } else {
        await writeXlsx(artifact, filePath);
    }

    return {
        filePath,
        fileName: path.basename(filePath),
        format: resolvedFormat,
        rowCount: artifact.rowCount,
    };
}

function uniqueFilePath(directory: string, baseName: string, format: ExportFormat): string {
    let candidate = path.join(directory, `${baseName}.${format}`);
    let counter = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(directory, `${baseName}-${counter}.${format}`);
        counter += 1;
    }
    return candidate;
}

/**
 * Agent-initiated export. Files always land in the app-managed exports folder;
 * the agent never chooses a directory or supplies a full path.
 */
export async function exportQueryToDirectory(
    artifact: QueryArtifact,
    options: ExportQueryOptions = {}
): Promise<ExportFileResult> {
    const format = options.format === 'csv' ? 'csv' : 'xlsx';
    const directory = options.directory
        ? path.resolve(options.directory)
        : exportDirectory();
    fs.mkdirSync(directory, { recursive: true });

    const baseName =
        sanitizeExportName(options.filename).replace(/\.(?:xlsx|csv)$/i, '') ||
        'chat2excel-export';
    const filePath = uniqueFilePath(directory, baseName, format);
    return writeQueryExport(artifact, filePath, format);
}
