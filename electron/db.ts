import duckdb from 'duckdb';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { app } from 'electron';

export class Database {
    private db: duckdb.Database;
    private initPromise: Promise<void> | null = null;
    private initialized = false;

    constructor() {
        // Use a persistent file in the userData directory
        // In development, this will be in AppData/Roaming/chat2excel
        const userDataPath = app.getPath('userData');
        const dbPath = path.join(userDataPath, 'chat2excel.duckdb');
        console.log(`[DB] Using database path: ${dbPath}`);

        this.db = new duckdb.Database(dbPath);

        // Start initialization immediately
        this.ensureInitialized().catch(err => {
            console.error('[DB] Critical initialization failure:', err);
        });
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

            try {
                // Metadata for table display names and descriptions
                await this.rawExecute('CREATE TABLE IF NOT EXISTS _metadata_tables (physical_name TEXT PRIMARY KEY, display_name TEXT, description TEXT)');
                // Metadata for column descriptions
                await this.rawExecute('CREATE TABLE IF NOT EXISTS _metadata_columns (table_name TEXT, column_name TEXT, description TEXT, PRIMARY KEY (table_name, column_name))');

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

    private rawExecute(sql: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, ...params, (err: any, res: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    }

    public async execute(sql: string, params: any[] = []): Promise<any[]> {
        await this.ensureInitialized();
        return this.rawExecute(sql, params);
    }

    public async importFile(filePath: string): Promise<string> {
        if (!filePath) {
            throw new Error("Invalid file path: path is undefined or empty.");
        }

        const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
        const fileName = path.basename(filePath, path.extname(filePath));

        // Final improved table name generation:
        // 1. Filter out only basic alphanumeric characters
        const safePart = fileName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        // 2. Use 'tbl_' prefix if filename has no alphanumeric chars (e.g. pure Chinese/Emoji) or too short
        const baseName = safePart.length >= 3 ? safePart.slice(0, 10) : 'tbl';
        // 3. Append timestamp and random salt for absolute uniqueness and SQL safety
        const salt = Math.random().toString(36).substring(2, 6);
        const timestamp = Date.now().toString().slice(-6);
        const tableName = `${baseName}_${timestamp}_${salt}`;
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.csv') {
            const query = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${normalizedPath}');`;
            await this.execute(query);
        } else if (ext === '.xlsx' || ext === '.xls') {
            await this.importExcel(filePath, tableName);
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }

        await this.execute('INSERT OR REPLACE INTO _metadata_tables (physical_name, display_name) VALUES (?, ?)', [tableName, fileName]);
        return tableName;
    }

    private async importExcel(filePath: string, tableName: string): Promise<void> {
        const fileBuffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const data = XLSX.utils.sheet_to_json(worksheet);
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error("Excel sheet is empty or invalid.");
        }

        const columns = Object.keys(data[0] as object);
        const createColumns = columns.map(col => `"${col}" TEXT`).join(', ');
        await this.execute(`CREATE OR REPLACE TABLE ${tableName} (${createColumns})`);

        const columnNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const insertQuery = `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`;

        for (const row of data) {
            const values = columns.map(col => (row as any)[col] ?? null);
            await this.execute(insertQuery, values);
        }
    }

    public async getTables(): Promise<{ name: string; displayName: string; description: string }[]> {
        // Filter out system metadata tables from the UI
        const res = await this.execute(`
            SELECT t.name, m.display_name, m.description 
            FROM (SHOW TABLES) AS t
            LEFT JOIN _metadata_tables AS m ON t.name = m.physical_name
            WHERE t.name NOT LIKE '_metadata_%'
        `);
        return res.map((row: any) => ({
            name: row.name,
            displayName: row.display_name || row.name,
            description: row.description || ''
        }));
    }

    public async getTableColumns(tableName: string): Promise<{ name: string; type: string; description: string }[]> {
        const columns = await this.execute(`DESCRIBE ${tableName}`);
        const metadata = await this.execute('SELECT column_name, description FROM _metadata_columns WHERE table_name = ?', [tableName]);
        const metaMap = new Map(metadata.map(m => [m.column_name, m.description]));

        return columns.map((col: any) => ({
            name: col.column_name,
            type: col.column_type,
            description: metaMap.get(col.column_name) || ''
        }));
    }

    public async updateTableDescription(tableName: string, description: string): Promise<void> {
        await this.execute('UPDATE _metadata_tables SET description = ? WHERE physical_name = ?', [description, tableName]);
    }

    public async dropTable(tableName: string): Promise<void> {
        await this.execute(`DROP TABLE IF EXISTS ${tableName}`);
        await this.execute('DELETE FROM _metadata_tables WHERE physical_name = ?', [tableName]);
        await this.execute('DELETE FROM _metadata_columns WHERE table_name = ?', [tableName]);
    }

    public async updateColumnDescription(tableName: string, columnName: string, description: string): Promise<void> {
        await this.execute('INSERT OR REPLACE INTO _metadata_columns (table_name, column_name, description) VALUES (?, ?, ?)', [tableName, columnName, description]);
    }
}

export const db = new Database();
