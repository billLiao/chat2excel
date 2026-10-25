/**
 * Typed, streaming tabular import.
 *
 * The old implementation read the whole file with SheetJS, created every column
 * as TEXT and inserted row by row. That made `SUM(amount)` fail and large files
 * extremely slow. This module:
 *
 *  - streams CSV and XLSX rows (constant memory)
 *  - samples the first rows and infers DuckDB types
 *  - writes batches through a sink supplied by the database layer
 *  - reports a per-sheet summary so the UI can explain what happened
 *
 * Legacy `.xls` is read through SheetJS (it is the only format ExcelJS cannot
 * stream) and is still typed.
 */

import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

export type ImportedDataType =
    | 'BIGINT'
    | 'DOUBLE'
    | 'DATE'
    | 'TIMESTAMP'
    | 'BOOLEAN'
    | 'VARCHAR';

export interface ImportedColumn {
    name: string;
    type: ImportedDataType;
    /** Number of sampled non-empty values that informed the type. */
    sampleCount?: number;
}

export interface SheetTableSink {
    /** Called after the header and sample were read. */
    begin(input: {
        sheetName: string;
        columns: ImportedColumn[];
    }): Promise<{ tableName: string; insert(rows: unknown[][]): Promise<void> }>;
}

export interface ImportedSheetSummary {
    sheetName: string;
    tableName: string;
    columns: ImportedColumn[];
    rowCount: number;
    warnings: string[];
    /** Stable dataset identity; assigned by the database layer. */
    datasetId?: string;
    /** True when an existing dataset was refreshed in place. */
    datasetUpdated?: boolean;
    importVersion?: number;
}

export interface ImportSummary {
    sheets: ImportedSheetSummary[];
    rowCount: number;
    warnings: string[];
}

export interface ImportOptions {
    maxRowsPerSheet?: number;
    sampleSize?: number;
    batchSize?: number;
}

const DEFAULT_MAX_ROWS = 500_000;
const DEFAULT_SAMPLE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 500;

const INTEGER_RE = /^[+-]?\d+$/;
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const ISO_DATETIME_RE =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const CURRENCY_PREFIX_RE = /^[$¥€£]\s*/;

function cleanHeader(name: string, index: number): string {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    return trimmed || `column_${index + 1}`;
}

function uniqueHeaders(raw: string[]): string[] {
    const seen = new Map<string, number>();
    return raw.map((name, index) => {
        const base = cleanHeader(name, index);
        const key = base.toLowerCase();
        const count = seen.get(key) || 0;
        seen.set(key, count + 1);
        return count === 0 ? base : `${base}_${count + 1}`;
    });
}

function isEmptyValue(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function flattenCellValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value !== 'object') return value;

    const cell = value as Record<string, unknown>;
    if ('error' in cell) return null;
    if ('result' in cell) return flattenCellValue(cell.result);
    if (Array.isArray(cell.richText)) {
        return cell.richText
            .map((part) => (part && typeof part === 'object' ? String((part as any).text ?? '') : ''))
            .join('');
    }
    if ('text' in cell) return cell.text;
    if (value instanceof Number) return Number(value);
    if (value instanceof Boolean) return Boolean(value);
    return String(value);
}

function parseNumericString(value: string): { value: number; integer: boolean } | null {
    let text = value.trim();
    if (!text) return null;

    let percent = false;
    if (text.endsWith('%')) {
        percent = true;
        text = text.slice(0, -1).trim();
    }
    text = text.replace(CURRENCY_PREFIX_RE, '').replace(/\s+/g, '');
    if (!text) return null;

    const integer = INTEGER_RE.test(text.replace(/,/g, ''));
    const normalized = text.replace(/,/g, '');
    if (!NUMBER_RE.test(normalized)) return null;

    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;
    // Percent strings keep their face value ("50%" -> 50) so that user
    // expectations in grouped reports are not silently divided by 100.
    void percent;
    return { value: number, integer };
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function normalizeDateString(value: string): string | null {
    const text = value.trim();
    let match = text.match(ISO_DATE_RE);
    if (match) {
        const [, y, m, d] = match;
        const date = new Date(Number(y), Number(m) - 1, Number(d));
        if (
            date.getFullYear() === Number(y) &&
            date.getMonth() === Number(m) - 1 &&
            date.getDate() === Number(d)
        ) {
            return `${y}-${pad(Number(m))}-${pad(Number(d))}`;
        }
        return null;
    }
    match = text.match(ISO_DATETIME_RE);
    if (match) {
        const [, y, m, d, hh, mm, ss] = match;
        const date = new Date(
            Number(y),
            Number(m) - 1,
            Number(d),
            Number(hh),
            Number(mm),
            Number(ss || 0)
        );
        if (
            date.getFullYear() === Number(y) &&
            date.getMonth() === Number(m) - 1 &&
            date.getDate() === Number(d) &&
            date.getHours() === Number(hh) &&
            date.getMinutes() === Number(mm)
        ) {
            return `${y}-${pad(Number(m))}-${pad(Number(d))} ${pad(Number(hh))}:${pad(
                Number(mm)
            )}:${pad(Number(ss || 0))}`;
        }
    }
    return null;
}

function dateToParts(value: Date): { date: string; dateTime: string; hasTime: boolean } {
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const hasTime =
        value.getHours() !== 0 ||
        value.getMinutes() !== 0 ||
        value.getSeconds() !== 0 ||
        value.getMilliseconds() !== 0;
    const dateTime = `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(
        value.getSeconds()
    )}`;
    return { date, dateTime, hasTime };
}

/**
 * Infer a column type from sampled raw values. Types are deliberately
 * conservative: anything mixed or ambiguous stays VARCHAR so that we never
 * silently turn IDs or codes into numbers.
 */
export function inferColumnType(values: unknown[]): ImportedDataType {
    const present = values.filter((value) => !isEmptyValue(value));
    if (present.length === 0) return 'VARCHAR';

    if (present.every((value) => value instanceof Date)) {
        const hasTime = present.some((value) => dateToParts(value as Date).hasTime);
        return hasTime ? 'TIMESTAMP' : 'DATE';
    }

    const strings = present.map((value) => String(value).trim()).filter(Boolean);
    if (strings.length === 0) return 'VARCHAR';

    if (strings.every((value) => /^(true|false)$/i.test(value))) {
        return 'BOOLEAN';
    }

    if (strings.every((value) => normalizeDateString(value) !== null)) {
        return strings.some((value) => normalizeDateString(value)!.includes(' '))
            ? 'TIMESTAMP'
            : 'DATE';
    }

    // Leading-zero integers are identifiers (zip codes, SKUs), not measures.
    const hasLeadingZeroIdentifier = strings.some(
        (value) => /^0\d+$/.test(value.replace(/,/g, '')) && value.replace(/,/g, '').length > 1
    );
    if (!hasLeadingZeroIdentifier) {
        const numbers = strings.map(parseNumericString);
        if (numbers.every((value) => value !== null)) {
            return numbers.every((value) => value!.integer) ? 'BIGINT' : 'DOUBLE';
        }
    }

    return 'VARCHAR';
}

function normalizeForColumn(value: unknown, type: ImportedDataType): unknown {
    if (isEmptyValue(value)) return null;

    switch (type) {
        case 'BIGINT': {
            if (value instanceof Date) return null;
            const parsed = typeof value === 'number' ? { value, integer: Number.isInteger(value) } : parseNumericString(String(value));
            if (!parsed) return null;
            return Number.isSafeInteger(parsed.value) ? Math.trunc(parsed.value) : String(Math.trunc(parsed.value));
        }
        case 'DOUBLE': {
            if (value instanceof Date) return null;
            const parsed = typeof value === 'number' ? { value } : parseNumericString(String(value));
            return parsed ? parsed.value : null;
        }
        case 'DATE': {
            if (value instanceof Date) return dateToParts(value).date;
            return normalizeDateString(String(value))?.slice(0, 10) ?? null;
        }
        case 'TIMESTAMP': {
            if (value instanceof Date) return dateToParts(value).dateTime;
            return normalizeDateString(String(value)) ?? null;
        }
        case 'BOOLEAN': {
            if (typeof value === 'boolean') return value;
            const text = String(value).trim().toLowerCase();
            if (text === 'true') return true;
            if (text === 'false') return false;
            return null;
        }
        case 'VARCHAR':
        default: {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed === '' ? null : trimmed;
            }
            if (typeof value === 'number' || typeof value === 'boolean') return value;
            const text = String(value).trim();
            return text === '' ? null : text;
        }
    }
}

function detectDelimiter(sample: string): string {
    const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    let inQuotes = false;
    for (let i = 0; i < sample.length; i++) {
        const char = sample[i];
        if (char === '"') {
            if (inQuotes && sample[i + 1] === '"') i++;
            else inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && char in counts) counts[char]++;
        if (!inQuotes && (char === '\n' || char === '\r')) break;
    }
    let best = ',';
    for (const [delimiter, count] of Object.entries(counts)) {
        if (count > counts[best]) best = delimiter;
    }
    return best;
}

function readFileHead(filePath: string, bytes = 8192): string {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const read = fs.readSync(fd, buffer, 0, bytes, 0);
        return buffer.subarray(0, read).toString('utf8').replace(/^\uFEFF/, '');
    } finally {
        fs.closeSync(fd);
    }
}

async function* parseCsvRows(
    filePath: string,
    delimiter: string
): AsyncGenerator<{ rowNumber: number; cells: string[] }> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    let rowNumber = 0;
    let firstChunk = true;

    const emitRow = (): { rowNumber: number; cells: string[] } | null => {
        if (row.length === 0 && field === '') return null;
        row.push(field);
        rowNumber++;
        const result = { rowNumber, cells: row };
        field = '';
        row = [];
        return result;
    };

    try {
        for await (const chunk of stream) {
            const text = firstChunk ? chunk.replace(/^\uFEFF/, '') : chunk;
            firstChunk = false;

            for (let i = 0; i < text.length; i++) {
                const char = text[i];

                if (inQuotes) {
                    if (char === '"') {
                        if (text[i + 1] === '"') {
                            field += '"';
                            i++;
                        } else {
                            inQuotes = false;
                        }
                    } else {
                        field += char;
                    }
                    continue;
                }

                if (char === '"' && field === '') {
                    inQuotes = true;
                    continue;
                }
                if (char === delimiter) {
                    row.push(field);
                    field = '';
                    continue;
                }
                if (char === '\n') {
                    const emitted = emitRow();
                    if (emitted) yield emitted;
                    continue;
                }
                if (char === '\r') {
                    if (text[i + 1] === '\n') i++;
                    const emitted = emitRow();
                    if (emitted) yield emitted;
                    continue;
                }
                field += char;
            }
        }

        if (field !== '' || row.length > 0) {
            const emitted = emitRow();
            if (emitted) yield emitted;
        }
    } finally {
        stream.destroy();
    }
}

interface RawSheet {
    name: string;
    rowGenerator: AsyncGenerator<{ rowNumber: number; cells: unknown[] }>;
}

async function* xlsxSheetRows(worksheet: ExcelJS.stream.xlsx.WorksheetReader): AsyncGenerator<{
    rowNumber: number;
    cells: unknown[];
}> {
    for await (const row of worksheet) {
        const cells: unknown[] = [];
        const values = row.values;
        const count = Array.isArray(values) ? values.length : 0;
        for (let column = 1; column <= count; column++) {
            cells.push(flattenCellValue(row.getCell(column).value));
        }
        yield { rowNumber: row.number, cells };
    }
}

async function* openXlsxSheets(filePath: string): AsyncGenerator<RawSheet> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
        entries: 'emit',
        sharedStrings: 'cache',
        hyperlinks: 'ignore',
        styles: 'ignore',
    });

    let index = 0;
    // WorkbookReader must be consumed worksheet by worksheet: advancing the
    // outer iterator before the current sheet's rows are drained skips data.
    for await (const worksheet of workbook) {
        index++;
        const worksheetName = String((worksheet as unknown as { name?: string }).name || `Sheet${index}`);
        yield {
            name: worksheetName,
            rowGenerator: xlsxSheetRows(worksheet),
        };
    }
}

async function* openLegacySheets(filePath: string): AsyncGenerator<RawSheet> {
    const workbook = XLSX.readFile(filePath, { type: 'file' });
    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: true,
            defval: null,
            blankrows: false,
        });
        yield {
            name,
            rowGenerator: (async function* (): AsyncGenerator<{
                rowNumber: number;
                cells: unknown[];
            }> {
                for (let index = 0; index < matrix.length; index++) {
                    const row = matrix[index];
                    yield { rowNumber: index + 1, cells: row.slice() };
                }
            })(),
        };
    }
}

function summarizeHeaders(cells: unknown[]): string[] {
    const trimmed = cells.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
        trimmed.pop();
    }
    return uniqueHeaders(trimmed);
}

async function importRawSheet(
    sheet: RawSheet,
    sink: SheetTableSink,
    options: Required<ImportOptions>,
    fileWarnings: string[]
): Promise<ImportedSheetSummary | null> {
    const warnings: string[] = [];
    const iterator = sheet.rowGenerator;

    let headerCells: unknown[] | null = null;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
        const cells = next.value.cells;
        if (cells.some((cell) => !isEmptyValue(cell))) {
            headerCells = cells;
            break;
        }
    }

    if (!headerCells) {
        return null;
    }

    const headers = summarizeHeaders(headerCells);
    if (headers.length === 0) {
        return null;
    }

    const sampleRows: unknown[][] = [];
    let totalRows = 0;
    let hitLimit = false;
    let pending = await iterator.next();

    while (!pending.done && sampleRows.length < options.sampleSize) {
        const { cells } = pending.value;
        if (!cells.some((cell) => !isEmptyValue(cell))) {
            pending = await iterator.next();
            continue;
        }
        sampleRows.push(padRow(cells, headers.length));
        totalRows++;
        pending = await iterator.next();
    }

    const types = headers.map((_, index) =>
        inferColumnType(sampleRows.map((row) => row[index]))
    );
    const columns: ImportedColumn[] = headers.map((name, index) => ({
        name,
        type: types[index],
        sampleCount: sampleRows.filter((row) => !isEmptyValue(row[index])).length,
    }));

    const { tableName, insert } = await sink.begin({ sheetName: sheet.name, columns });

    const writeBatch = async (batch: unknown[][]) => {
        if (batch.length === 0) return;
        const normalized = batch.map((row) =>
            columns.map((column, index) => normalizeForColumn(row[index], column.type))
        );
        await insert(normalized);
    };

    let batch: unknown[][] = [];
    const pushRow = async (cells: unknown[]) => {
        if (!cells.some((cell) => !isEmptyValue(cell))) return;
        if (totalRows >= options.maxRowsPerSheet) {
            hitLimit = true;
            return;
        }
        batch.push(padRow(cells, headers.length));
        totalRows++;
        if (batch.length >= options.batchSize) {
            await writeBatch(batch);
            batch = [];
        }
    };

    for (const row of sampleRows) {
        batch.push(row);
        if (batch.length >= options.batchSize) {
            await writeBatch(batch);
            batch = [];
        }
    }

    while (!pending.done) {
        const { cells } = pending.value;
        await pushRow(cells);
        if (hitLimit) break;
        pending = await iterator.next();
    }

    if (batch.length > 0) {
        await writeBatch(batch);
    }

    if (hitLimit) {
        warnings.push(
            `Import stopped at ${options.maxRowsPerSheet.toLocaleString()} rows for sheet "${sheet.name}".`
        );
        fileWarnings.push(warnings[warnings.length - 1]);
    }

    return {
        sheetName: sheet.name,
        tableName,
        columns,
        rowCount: totalRows,
        warnings,
    };
}

function padRow(cells: unknown[], length: number): unknown[] {
    const row = cells.slice(0, length);
    while (row.length < length) row.push(null);
    return row;
}

/**
 * Import a CSV/XLSX/XLS file into tables through the given sink. All sheets are
 * imported; the caller decides how table names are derived.
 */
export async function importTabularFile(
    filePath: string,
    sink: SheetTableSink,
    options: ImportOptions = {}
): Promise<ImportSummary> {
    const ext = path.extname(filePath).toLowerCase();
    const resolved: Required<ImportOptions> = {
        maxRowsPerSheet: options.maxRowsPerSheet ?? DEFAULT_MAX_ROWS,
        sampleSize: options.sampleSize ?? DEFAULT_SAMPLE_SIZE,
        batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    };

    const warnings: string[] = [];
    let sheets: AsyncIterable<RawSheet>;

    if (ext === '.csv') {
        const head = readFileHead(filePath);
        const delimiter = detectDelimiter(head);
        const csvSheet: RawSheet = {
            name: path.basename(filePath, ext),
            rowGenerator: parseCsvRows(filePath, delimiter),
        };
        sheets = (async function* () {
            yield csvSheet;
        })();
    } else if (ext === '.xlsx') {
        sheets = openXlsxSheets(filePath);
    } else if (ext === '.xls') {
        sheets = openLegacySheets(filePath);
    } else {
        throw new Error(`Unsupported file format: ${ext}`);
    }

    const summaries: ImportedSheetSummary[] = [];
    for await (const sheet of sheets) {
        const summary = await importRawSheet(sheet, sink, resolved, warnings);
        if (summary) summaries.push(summary);
    }

    if (summaries.length === 0) {
        throw new Error('The file does not contain any readable rows.');
    }

    return {
        sheets: summaries,
        rowCount: summaries.reduce((total, sheet) => total + sheet.rowCount, 0),
        warnings,
    };
}
