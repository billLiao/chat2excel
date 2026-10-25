import duckdb from 'duckdb';
import path from 'path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { app } from 'electron';
import { importTabularFile, type ImportSummary, type ImportedColumn } from './importer';
import {
    assertSqlLength,
    stripTrailingSemicolons,
    validateSerializedSql,
    wrapWithRowLimit,
} from './agent/sql-guard';
import {
    normalizeValue,
    queryResults,
    type QueryArtifact,
    type QueryColumn,
} from './agent/result-store';
import type { DatasetInfo } from '../src/lib/charts/types';

const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_ROWS = 1_000;
const MAX_QUERY_ROWS = 10_000;
const MAX_INSERT_PARAMS = 30_000;

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * SUMMARIZE serializes numeric min/max as strings. Convert them back so the
 * agent sees comparable numbers instead of "49.5".
 */
function summaryBound(type: string, value: unknown): unknown {
    const normalized = normalizeValue(value);
    if (normalized === null || typeof normalized === 'number') return normalized;
    if (/^(U?INT|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL|REAL|SMALLINT|TINYINT)/i.test(type)) {
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : normalized;
    }
    return normalized;
}

export interface QueryOptions {
    maxRows?: number;
    timeoutMs?: number;
    /** Optional allow-list, e.g. the tables selected in the chat context. */
    allowedTables?: Iterable<string>;
}

export interface ImportFileOptions {
    /**
     * `auto` updates a dataset imported from the same file/sheet in place, so
     * saved SQL keeps working after a refresh. `new` always creates a copy.
     */
    mode?: 'auto' | 'new';
}

interface DatasetRow {
    id: string;
    display_name: string;
    physical_name: string;
    source_key: string | null;
    source_kind: string | null;
    source_path: string | null;
    fingerprint: string | null;
    row_count: number | string | null;
    import_version: number | string | null;
    updated_at: number | string | null;
}

export interface TableProfileColumn {
    name: string;
    type: string;
    min: unknown;
    max: unknown;
    approxUnique: number | null;
    nullPercentage: number | null;
    average: number | null;
}

export interface TableProfile {
    tableName: string;
    rowCount: number;
    columns: TableProfileColumn[];
    sampleRows: Record<string, unknown>[];
    truncatedSample: boolean;
}

export class Database {
    private db!: duckdb.Database;
    private initPromise: Promise<void> | null = null;
    private initialized = false;
    private readChain: Promise<unknown> = Promise.resolve();
    /** Bumped whenever imported data changes; used to invalidate chart caches. */
    private dataVersion = 0;

    constructor() {
        // Initialization deferred to init()
    }

    public async init(): Promise<void> {
        if (this.initialized) return;

        const userDataPath = app.getPath('userData');
        const dbPath = path.join(userDataPath, 'chat2excel.duckdb');
        console.log(`[DB] Using database path: ${dbPath}`);

        this.db = new duckdb.Database(dbPath);

        try {
            await this.ensureInitialized();
        } catch (err) {
            console.error('[DB] Critical initialization failure:', err);
            throw err;
        }
    }

    public async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            console.log('[DB] Starting initialization...');

            await new Promise<void>((resolve, reject) => {
                this.db.all('SELECT 1', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Analysis queries must never reach the filesystem. Imports are read
            // in Node and written through parameters, so DuckDB itself does not
            // need external access at runtime.
            await this.rawExecute('SET enable_external_access = false');
            await this.rawExecute('SET lock_configuration = true');

            try {
                await this.rawExecute(
                    'CREATE TABLE IF NOT EXISTS _metadata_tables (physical_name TEXT PRIMARY KEY, display_name TEXT, description TEXT)'
                );
                await this.rawExecute(
                    'CREATE TABLE IF NOT EXISTS _metadata_columns (table_name TEXT, column_name TEXT, description TEXT, PRIMARY KEY (table_name, column_name))'
                );
                await this.rawExecute(`
                    CREATE TABLE IF NOT EXISTS _metadata_datasets (
                        id TEXT PRIMARY KEY,
                        display_name TEXT NOT NULL,
                        physical_name TEXT NOT NULL UNIQUE,
                        source_key TEXT,
                        source_kind TEXT,
                        source_path TEXT,
                        fingerprint TEXT,
                        columns_json TEXT,
                        row_count BIGINT DEFAULT 0,
                        import_version INTEGER DEFAULT 1,
                        created_at BIGINT,
                        updated_at BIGINT
                    )
                `);
                await this.backfillDatasets();

                this.initialized = true;
                console.log('[DB] Metadata tables initialized successfully');
            } catch (e) {
                console.error('[DB] Failed to create metadata tables:', e);
                this.initPromise = null;
                throw e;
            }
        })();

        return this.initPromise;
    }

    /** Close the DuckDB handle (used on quit and in tests). */
    public close(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            try {
                this.db.close(() => {
                    this.initialized = false;
                    this.initPromise = null;
                    resolve();
                });
            } catch {
                resolve();
            }
        });
    }

    /** Give tables created before dataset identity existed a stable record. */
    private async backfillDatasets(): Promise<void> {
        const orphans = await this.rawExecute(`
            SELECT m.physical_name, m.display_name
            FROM _metadata_tables AS m
            LEFT JOIN _metadata_datasets AS d ON d.physical_name = m.physical_name
            WHERE d.id IS NULL
        `);
        const now = Date.now();
        for (const row of orphans) {
            const physicalName = String(row.physical_name);
            const id = `ds_legacy_${createHash('sha1').update(physicalName).digest('hex').slice(0, 12)}`;
            await this.rawExecute(
                `INSERT INTO _metadata_datasets
                    (id, display_name, physical_name, source_key, source_kind, source_path,
                     fingerprint, columns_json, row_count, import_version, created_at, updated_at)
                 VALUES (?, ?, ?, NULL, 'legacy', NULL, NULL, NULL, 0, 1, ?, ?)
                 ON CONFLICT (id) DO NOTHING`,
                [id, String(row.display_name || physicalName), physicalName, now, now]
            );
        }
    }

    public getDataVersion(): number {
        return this.dataVersion;
    }

    public async getDatasets(): Promise<DatasetInfo[]> {
        await this.ensureInitialized();
        const rows = (await this.rawExecute(
            'SELECT * FROM _metadata_datasets ORDER BY updated_at DESC, display_name'
        )) as DatasetRow[];
        return rows.map((row) => ({
            id: row.id,
            displayName: row.display_name,
            physicalName: row.physical_name,
            sourceKey: row.source_key || undefined,
            sourceKind: row.source_kind || undefined,
            sourcePath: row.source_path || undefined,
            fingerprint: row.fingerprint || undefined,
            rowCount: Number(row.row_count ?? 0),
            importVersion: Number(row.import_version ?? 1),
            updatedAt: Number(row.updated_at ?? 0),
        }));
    }

    public async getDatasetVersions(ids: string[]): Promise<Record<string, number>> {
        await this.ensureInitialized();
        const unique = Array.from(new Set(ids.filter(Boolean)));
        if (unique.length === 0) return {};
        const placeholders = unique.map(() => '?').join(', ');
        const rows = await this.rawExecute(
            `SELECT id, import_version FROM _metadata_datasets WHERE id IN (${placeholders})`,
            unique
        );
        const versions: Record<string, number> = {};
        for (const row of rows) {
            versions[String(row.id)] = Number(row.import_version ?? 1);
        }
        return versions;
    }

    private rawExecute(sql: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, ...params, (err: any, res: any) => {
                if (err) reject(err);
                else resolve(res);
            });
        });
    }

    private rawExecuteWithTimeout(
        sql: string,
        params: any[],
        timeoutMs: number
    ): Promise<any[]> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try {
                    this.db.interrupt();
                } catch {
                    // ignore interrupt failures
                }
                reject(
                    new Error(
                        `The query took longer than ${Math.round(timeoutMs / 1000)}s and was cancelled. ` +
                            'Try narrowing the date range or adding filters.'
                    )
                );
            }, timeoutMs);

            this.db.all(sql, ...params, (err: any, res: any) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (err) reject(err);
                else resolve(res);
            });
        });
    }

    /** Raw execution for internal, already-trusted statements. */
    public async execute(sql: string, params: any[] = []): Promise<any[]> {
        await this.ensureInitialized();
        return this.rawExecute(sql, params);
    }

    private async withReadLock<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.readChain;
        let release!: () => void;
        this.readChain = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous.catch(() => undefined);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    private async assertKnownTable(tableName: string): Promise<void> {
        if (!tableName || tableName.startsWith('_metadata_')) {
            throw new Error(`Unknown table: ${tableName}`);
        }
        const rows = await this.rawExecute(
            'SELECT name FROM (SHOW TABLES) AS t WHERE lower(name) = lower(?)',
            [tableName]
        );
        if (rows.length === 0) {
            throw new Error(`Unknown table: ${tableName}`);
        }
    }

    /**
     * Validate and execute a read-only analytical query. Results are stored as
     * an artifact so charts, previews and exports share the same rows.
     */
    public async query(sql: string, options: QueryOptions = {}): Promise<QueryArtifact> {
        await this.ensureInitialized();

        const cleaned = stripTrailingSemicolons(sql);
        assertSqlLength(cleaned);

        let serialized: any;
        try {
            const parsed = await this.rawExecute(
                'SELECT json_serialize_sql(?::VARCHAR) AS j',
                [cleaned]
            );
            serialized = JSON.parse(parsed[0].j);
        } catch (error: any) {
            throw new Error(`SQL could not be parsed: ${error.message}`);
        }

        const allowedTables = await getAllTableNamesForGuard(this);
        const scopedTables =
            options.allowedTables && Array.from(options.allowedTables).length > 0
                ? new Set(Array.from(options.allowedTables, (name) => name.toLowerCase()))
                : null;
        const tables = validateSerializedSql(serialized, {
            allowedTables: scopedTables
                ? allowedTables.filter((name) => scopedTables.has(name.toLowerCase()))
                : allowedTables,
        });

        const maxRows = clamp(options.maxRows ?? DEFAULT_QUERY_ROWS, 1, MAX_QUERY_ROWS);
        const timeoutMs = clamp(options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 1_000, 120_000);
        const wrapped = wrapWithRowLimit(cleaned, maxRows);

        const startedAt = Date.now();
        const { describe, rows } = await this.withReadLock(async () => {
            const description = await this.rawExecuteWithTimeout(
                `DESCRIBE ${wrapped}`,
                [],
                timeoutMs
            );
            const data = await this.rawExecuteWithTimeout(wrapped, [], timeoutMs);
            return { describe: description, rows: data };
        });

        const columns: QueryColumn[] = describe.map((column: any) => ({
            name: String(column.column_name),
            type: String(column.column_type),
        }));

        const truncated = rows.length > maxRows;
        const limitedRows = truncated ? rows.slice(0, maxRows) : rows;
        const rowArrays = limitedRows.map((row: any) =>
            columns.map((column) => row[column.name])
        );

        return queryResults.save({
            sql: cleaned,
            tables,
            columns,
            rows: rowArrays,
            rowCount: limitedRows.length,
            truncated,
            elapsedMs: Date.now() - startedAt,
        });
    }

    public async queryPreview(sql: string, options: QueryOptions = {}) {
        const artifact = await this.query(sql, options);
        return queryResults.preview(artifact.id);
    }

    public getQueryPage(queryId: string, offset: number, limit: number) {
        return queryResults.page(queryId, offset, limit);
    }

    public getQueryArtifact(queryId: string): QueryArtifact {
        return queryResults.require(queryId);
    }

    public async importFile(filePath: string): Promise<string> {
        const summary = await this.importFileDetailed(filePath);
        return summary.sheets[0].tableName;
    }

    public async importFileDetailed(
        filePath: string,
        options: ImportFileOptions = {}
    ): Promise<ImportSummary> {
        if (!filePath) {
            throw new Error('Invalid file path: path is undefined or empty.');
        }

        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.xls') {
            throw new Error(`Unsupported file format: ${ext}`);
        }

        const fileName = path.basename(filePath, ext);
        const fingerprint = await fileFingerprint(filePath);
        const mode = options.mode === 'new' ? 'new' : 'auto';

        interface SheetImportRecord {
            datasetId: string;
            tableName: string;
            backupName?: string;
            isNew: boolean;
            importVersion: number;
            sourceKey: string;
            columnsJson: string;
        }

        const records = new Map<string, SheetImportRecord>();
        const created: SheetImportRecord[] = [];
        let sheetIndex = 0;

        try {
            const summary = await importTabularFile(filePath, {
                begin: async ({ sheetName, columns }) => {
                    sheetIndex++;
                    const sourceKey = `${fileName.toLowerCase()}::${sheetName.toLowerCase()}`;
                    const existing =
                        mode === 'new' ? null : await this.findDatasetBySourceKey(sourceKey);
                    const isNew = !existing;
                    const datasetId = existing?.id || `ds_${randomUUID()}`;
                    const tableName =
                        existing?.physical_name ||
                        (await this.createPhysicalName(fileName, sourceKey));

                    // Rename instead of drop: a failed re-import can put the
                    // previous table back without losing user data.
                    let backupName: string | undefined;
                    if (await this.tableExists(tableName)) {
                        backupName = `${tableName}__backup_${Date.now().toString(36)}`;
                        await this.execute(
                            `ALTER TABLE ${quoteIdent(tableName)} RENAME TO ${quoteIdent(backupName)}`
                        );
                    }

                    const record: SheetImportRecord = {
                        datasetId,
                        tableName,
                        backupName,
                        isNew,
                        importVersion: isNew
                            ? 1
                            : Number(existing?.import_version ?? 1) + 1,
                        sourceKey,
                        columnsJson: JSON.stringify(columns),
                    };
                    // Track the record before creating the table: if creation
                    // throws, the rollback loop must still know about the
                    // backup that was renamed away a line above.
                    created.push(record);
                    records.set(sheetName, record);

                    await this.createTypedTable(tableName, columns);

                    return {
                        tableName,
                        insert: (rows: unknown[][]) =>
                            this.insertBatch(tableName, columns, rows),
                    };
                },
            });

            for (const sheet of summary.sheets) {
                const record = records.get(sheet.sheetName);
                if (!record) continue;
                const displayName =
                    summary.sheets.length > 1
                        ? `${fileName} · ${sheet.sheetName}`
                        : fileName;
                const now = Date.now();

                await this.execute(
                    `INSERT INTO _metadata_datasets
                        (id, display_name, physical_name, source_key, source_kind, source_path,
                         fingerprint, columns_json, row_count, import_version, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (id) DO UPDATE SET
                        display_name = excluded.display_name,
                        physical_name = excluded.physical_name,
                        source_key = excluded.source_key,
                        source_kind = excluded.source_kind,
                        source_path = excluded.source_path,
                        fingerprint = excluded.fingerprint,
                        columns_json = excluded.columns_json,
                        row_count = excluded.row_count,
                        import_version = excluded.import_version,
                        updated_at = excluded.updated_at`,
                    [
                        record.datasetId,
                        displayName,
                        record.tableName,
                        record.sourceKey,
                        ext.slice(1),
                        filePath,
                        fingerprint,
                        record.columnsJson,
                        sheet.rowCount,
                        record.importVersion,
                        now,
                        now,
                    ]
                );

                await this.execute(
                    `INSERT INTO _metadata_tables (physical_name, display_name)
                     VALUES (?, ?)
                     ON CONFLICT (physical_name) DO UPDATE SET display_name = excluded.display_name`,
                    [record.tableName, displayName]
                );

                sheet.datasetId = record.datasetId;
                sheet.datasetUpdated = !record.isNew;
                sheet.importVersion = record.importVersion;
            }

            for (const record of created) {
                if (!record.backupName) continue;
                await this.execute(
                    `DROP TABLE IF EXISTS ${quoteIdent(record.backupName)}`
                ).catch(() => undefined);
            }

            this.dataVersion += 1;
            return summary;
        } catch (error) {
            for (const record of [...created].reverse()) {
                await this.execute(
                    `DROP TABLE IF EXISTS ${quoteIdent(record.tableName)}`
                ).catch(() => undefined);
                if (record.backupName) {
                    await this.execute(
                        `ALTER TABLE ${quoteIdent(record.backupName)} RENAME TO ${quoteIdent(record.tableName)}`
                    ).catch(() => undefined);
                }
            }
            throw error;
        }
    }

    private async tableExists(tableName: string): Promise<boolean> {
        const rows = await this.rawExecute(
            'SELECT name FROM (SHOW TABLES) AS t WHERE lower(name) = lower(?)',
            [tableName]
        );
        return rows.length > 0;
    }

    private async findDatasetBySourceKey(sourceKey: string): Promise<DatasetRow | null> {
        const rows = (await this.rawExecute(
            'SELECT * FROM _metadata_datasets WHERE lower(source_key) = lower(?) LIMIT 1',
            [sourceKey]
        )) as DatasetRow[];
        return rows[0] || null;
    }

    private async createPhysicalName(fileName: string, sourceKey: string): Promise<string> {
        const base = fileName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12) || 'tbl';
        const hash = createHash('sha1').update(sourceKey).digest('hex').slice(0, 8);
        let candidate = `ds_${base}_${hash}`.slice(0, 60);
        let counter = 2;
        while (await this.tableExists(candidate)) {
            candidate = `ds_${base}_${hash}_${counter}`.slice(0, 60);
            counter += 1;
        }
        return candidate;
    }

    private async createTypedTable(tableName: string, columns: ImportedColumn[]): Promise<void> {
        if (columns.length === 0) {
            throw new Error('The file has no columns.');
        }
        const columnSql = columns
            .map((column) => `${quoteIdent(column.name)} ${column.type}`)
            .join(', ');
        await this.execute(
            `CREATE TABLE ${quoteIdent(tableName)} (${columnSql})`
        );
    }

    private async insertBatch(
        tableName: string,
        columns: ImportedColumn[],
        rows: unknown[][]
    ): Promise<void> {
        if (rows.length === 0) return;

        const columnNames = columns.map((column) => quoteIdent(column.name)).join(', ');
        const rowsPerStatement = Math.max(
            1,
            Math.floor(MAX_INSERT_PARAMS / Math.max(1, columns.length))
        );

        for (let start = 0; start < rows.length; start += rowsPerStatement) {
            const chunk = rows.slice(start, start + rowsPerStatement);
            const valuesSql = chunk
                .map(() => `(${columns.map(() => '?').join(', ')})`)
                .join(', ');
            await this.execute(
                `INSERT INTO ${quoteIdent(tableName)} (${columnNames}) VALUES ${valuesSql}`,
                chunk.flat()
            );
        }
    }

    public async getTables(): Promise<
        {
            name: string;
            displayName: string;
            description: string;
            datasetId?: string;
            importVersion?: number;
            rowCount?: number;
        }[]
    > {
        const res = await this.execute(`
            SELECT t.name,
                   COALESCE(m.display_name, d.display_name, t.name) AS display_name,
                   COALESCE(m.description, '') AS description,
                   d.id AS dataset_id,
                   COALESCE(d.import_version, 1) AS import_version,
                   COALESCE(d.row_count, 0) AS row_count
            FROM (SHOW TABLES) AS t
            LEFT JOIN _metadata_tables AS m ON t.name = m.physical_name
            LEFT JOIN _metadata_datasets AS d ON t.name = d.physical_name
            WHERE t.name NOT LIKE '_metadata_%'
        `);
        return res.map((row: any) => ({
            name: row.name,
            displayName: row.display_name || row.name,
            description: row.description || '',
            datasetId: row.dataset_id || undefined,
            importVersion: Number(row.import_version ?? 1),
            rowCount: Number(row.row_count ?? 0),
        }));
    }

    public async getTableColumns(
        tableName: string
    ): Promise<{ name: string; type: string; description: string }[]> {
        await this.assertKnownTable(tableName);
        const columns = await this.execute(`DESCRIBE ${quoteIdent(tableName)}`);
        const metadata = await this.execute(
            'SELECT column_name, description FROM _metadata_columns WHERE table_name = ?',
            [tableName]
        );
        const metaMap = new Map(metadata.map((m: any) => [m.column_name, m.description]));

        return columns.map((col: any) => ({
            name: col.column_name,
            type: col.column_type,
            description: metaMap.get(col.column_name) || '',
        }));
    }

    /**
     * Row counts for the requested tables (all tables when omitted). One UNION
     * query keeps the cost proportional to the number of tables, not round trips.
     */
    public async getTableRowCounts(tableNames?: string[]): Promise<Record<string, number>> {
        await this.ensureInitialized();
        const tables = await this.getTables();
        const wanted = tableNames?.length
            ? tables.filter((table) =>
                  tableNames.some((name) => name.toLowerCase() === table.name.toLowerCase())
              )
            : tables;
        if (wanted.length === 0) return {};

        const sql = wanted
            .map(
                (table) =>
                    `SELECT '${table.name.replace(/'/g, "''")}' AS table_name, COUNT(*) AS row_count FROM ${quoteIdent(
                        table.name
                    )}`
            )
            .join(' UNION ALL ');
        const rows = await this.rawExecute(sql);
        const counts: Record<string, number> = {};
        for (const row of rows) {
            counts[String(row.table_name)] = Number(row.row_count);
        }
        for (const table of wanted) {
            if (counts[table.name] === undefined) counts[table.name] = 0;
        }
        return counts;
    }

    /**
     * Column statistics + a small sample. `SUMMARIZE` is DuckDB-native and
     * works for every imported type, so profiling never needs to scan rows in JS.
     */
    public async getTableProfile(tableName: string, sampleLimit = 8): Promise<TableProfile> {
        await this.assertKnownTable(tableName);

        const limit = clamp(sampleLimit, 1, 50);
        const summary = await this.rawExecute(`SUMMARIZE ${quoteIdent(tableName)}`);
        const countRows = await this.rawExecute(
            `SELECT COUNT(*) AS row_count FROM ${quoteIdent(tableName)}`
        );
        const sampleRows = await this.rawExecute(
            `SELECT * FROM ${quoteIdent(tableName)} LIMIT ${limit + 1}`
        );

        const columns: TableProfileColumn[] = summary.map((column: any) => ({
            name: String(column.column_name),
            type: String(column.column_type),
            min: summaryBound(String(column.column_type), column.min),
            max: summaryBound(String(column.column_type), column.max),
            approxUnique:
                column.approx_unique === null || column.approx_unique === undefined
                    ? null
                    : Number(column.approx_unique),
            nullPercentage:
                column.null_percentage === null || column.null_percentage === undefined
                    ? null
                    : Number(column.null_percentage),
            average:
                column.avg === null || column.avg === undefined ? null : Number(column.avg),
        }));

        return {
            tableName,
            rowCount: Number(countRows[0]?.row_count ?? 0),
            columns,
            sampleRows: sampleRows
                .slice(0, limit)
                .map((row: any) =>
                    Object.fromEntries(
                        Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
                    )
                ),
            truncatedSample: sampleRows.length > limit,
        };
    }

    public async updateTableDescription(tableName: string, description: string): Promise<void> {
        await this.assertKnownTable(tableName);
        await this.execute('UPDATE _metadata_tables SET description = ? WHERE physical_name = ?', [
            description,
            tableName,
        ]);
    }

    public async dropTable(tableName: string): Promise<void> {
        await this.assertKnownTable(tableName);
        await this.execute(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);
        await this.execute('DELETE FROM _metadata_tables WHERE physical_name = ?', [tableName]);
        await this.execute('DELETE FROM _metadata_columns WHERE table_name = ?', [tableName]);
        await this.execute('DELETE FROM _metadata_datasets WHERE physical_name = ?', [tableName]);
        this.dataVersion += 1;
    }

    public async updateColumnDescription(
        tableName: string,
        columnName: string,
        description: string
    ): Promise<void> {
        await this.assertKnownTable(tableName);
        await this.execute(
            'INSERT OR REPLACE INTO _metadata_columns (table_name, column_name, description) VALUES (?, ?, ?)',
            [tableName, columnName, description]
        );
    }
}

async function getAllTableNamesForGuard(database: Database): Promise<string[]> {
    const tables = await database.getTables();
    return tables.map((table) => table.name);
}

/** Content hash used to tell whether an existing dataset actually changed. */
function fileFingerprint(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

export const db = new Database();
