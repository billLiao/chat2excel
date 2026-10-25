/**
 * Read-only SQL guard.
 *
 * The model is allowed to run analytical SELECT queries only. We parse the SQL
 * with DuckDB itself (`json_serialize_sql`) instead of relying on regexes, then
 * validate the AST:
 *
 *  - exactly one statement, rooted in SELECT / set-operation
 *  - no table functions (read_csv, read_parquet, query, glob, ...)
 *  - no filesystem / network / configuration functions
 *  - every base table must be an imported table or a CTE defined in the query
 *  - no schema-qualified names (information_schema, duckdb_*, ...)
 *
 * The guard is pure with respect to the parsed AST so it can be unit-tested
 * without a database connection.
 */

export class SqlGuardError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'SqlGuardError';
        this.code = code;
    }
}

export interface SqlGuardOptions {
    /** Physical table names that may be queried. */
    allowedTables: Iterable<string>;
    /** Hard upper bound for the SQL text. */
    maxSqlLength?: number;
}

export interface ValidatedQuery {
    sql: string;
    tables: string[];
}

interface AstNode {
    type?: string;
    [key: string]: unknown;
}

interface SerializedStatement {
    node?: AstNode;
}

export interface SerializedSql {
    error?: boolean;
    error_type?: string;
    error_message?: string;
    statements?: SerializedStatement[];
}

const MAX_SQL_LENGTH = 20_000;

const ROOT_NODE_TYPES = new Set(['SELECT_NODE', 'SET_OPERATION_NODE']);

/**
 * Functions that can touch the filesystem, network, configuration or load
 * native code. Scalar variants matter because a table function can be hidden
 * inside a scalar expression, e.g. `SELECT read_text('C:/secret')`.
 */
const DENIED_FUNCTION_PREFIXES = [
    'read_',
    'write_',
    'scan_',
    'parquet_',
    'csv_',
    'json_',
    'delta_',
    'iceberg_',
    'postgres_',
    'mysql_',
    'sqlite_',
    'duckdb_',
    'pragma_',
    'inet_',
];

const DENIED_FUNCTIONS = new Set([
    'glob',
    'query',
    'query_table',
    'getenv',
    'set_config',
    'current_setting',
    'load_extension',
    'install_extension',
    'load',
    'install',
    'attach',
    'detach',
    'copy',
    'export_database',
    'import_database',
    'force_checkpoint',
    'checkpoint',
    'sniff_csv',
    'read_text',
    'read_blob',
    'read_json',
    'read_json_auto',
    'read_json_objects',
    'read_ndjson',
    'read_ndjson_auto',
    'read_csv',
    'read_csv_auto',
    'read_parquet',
    'read_xlsx',
    'read_xls',
    'httpfs',
    'shell',
    'system',
    'exec',
    'eval',
    'create_secret',
    'create_temp_secret',
]);

const DENIED_NODE_TYPES = new Set([
    'TABLE_FUNCTION',
    'SHOW_REF',
    'PRAGMA',
    'ATTACH',
    'DETACH',
    'COPY',
    'INSERT',
    'UPDATE',
    'DELETE',
    'CREATE',
    'DROP',
    'ALTER',
    'CALL',
    'EXPLAIN',
]);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * Validate a serialized DuckDB AST. Throws {@link SqlGuardError} on rejection.
 */
export function validateSerializedSql(
    serialized: SerializedSql,
    options: SqlGuardOptions
): string[] {
    if (serialized.error) {
        throw new SqlGuardError(
            'SYNTAX',
            serialized.error_message || 'SQL could not be parsed.'
        );
    }

    const statements = serialized.statements || [];
    if (statements.length === 0) {
        throw new SqlGuardError('EMPTY', 'No SQL statement was provided.');
    }
    if (statements.length > 1) {
        throw new SqlGuardError(
            'MULTI_STATEMENT',
            'Only one SQL statement is allowed.'
        );
    }

    const root = statements[0]?.node;
    if (!root || !root.type || !ROOT_NODE_TYPES.has(root.type)) {
        throw new SqlGuardError(
            'NOT_READ_ONLY',
            'Only read-only SELECT queries are allowed.'
        );
    }

    const allowedTables = new Set(
        Array.from(options.allowedTables, (name) => normalizeName(name))
    );
    const cteNames = new Set<string>();
    const baseTables = new Set<string>();

    collectCteNames(root, cteNames);
    walk(root, (node) => {
        const type = node.type;
        if (!type) return;

        if (DENIED_NODE_TYPES.has(type)) {
            throw new SqlGuardError(
                'FORBIDDEN_NODE',
                type === 'TABLE_FUNCTION'
                    ? 'Table functions are not allowed. Query an imported table instead.'
                    : `Statement or node type "${type}" is not allowed.`
            );
        }

        if (type === 'BASE_TABLE') {
            const schemaName = String(node.schema_name || '');
            const catalogName = String(node.catalog_name || '');
            const tableName = normalizeName(String(node.table_name || ''));

            if (!tableName) {
                throw new SqlGuardError('INVALID_TABLE', 'A table reference is empty.');
            }
            if (schemaName || catalogName) {
                throw new SqlGuardError(
                    'SCHEMA_ACCESS',
                    `Schema-qualified table "${schemaName || catalogName}.${tableName}" is not allowed.`
                );
            }

            if (cteNames.has(tableName)) {
                return;
            }
            if (!allowedTables.has(tableName)) {
                throw new SqlGuardError(
                    'UNKNOWN_TABLE',
                    `Table "${tableName}" is not available. Only imported tables can be queried.`
                );
            }
            baseTables.add(tableName);
        }

        if (type === 'FUNCTION') {
            checkFunction(String(node.function_name || ''));
        }
    });

    return Array.from(baseTables);
}

function collectCteNames(root: AstNode, output: Set<string>): void {
    walk(root, (node) => {
        if (!isObject(node.cte_map)) return;
        const entries = (node.cte_map as { map?: unknown }).map;
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (isObject(entry) && typeof entry.key === 'string') {
                output.add(normalizeName(entry.key));
            }
        }
    });
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
    visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (isObject(item) && typeof (item as AstNode).type === 'string') {
                    walk(item as AstNode, visit);
                } else if (isObject(item)) {
                    walkUnknown(item, visit);
                }
            }
        } else if (isObject(value)) {
            if (typeof (value as AstNode).type === 'string') {
                walk(value as AstNode, visit);
            } else {
                walkUnknown(value, visit);
            }
        }
    }
}

function walkUnknown(value: Record<string, unknown>, visit: (node: AstNode) => void): void {
    for (const nested of Object.values(value)) {
        if (Array.isArray(nested)) {
            for (const item of nested) {
                if (isObject(item)) walkUnknown(item, visit);
            }
        } else if (isObject(nested)) {
            if (typeof (nested as AstNode).type === 'string') {
                walk(nested as AstNode, visit);
            } else {
                walkUnknown(nested, visit);
            }
        }
    }
}

function checkFunction(rawName: string): void {
    const name = normalizeName(rawName);
    if (!name) return;

    if (DENIED_FUNCTIONS.has(name)) {
        throw new SqlGuardError(
            'FORBIDDEN_FUNCTION',
            `Function "${name}" is not allowed in analysis queries.`
        );
    }
    for (const prefix of DENIED_FUNCTION_PREFIXES) {
        if (name.startsWith(prefix)) {
            throw new SqlGuardError(
                'FORBIDDEN_FUNCTION',
                `Function "${name}" is not allowed in analysis queries.`
            );
        }
    }
}

/**
 * Remove trailing semicolons/whitespace. A single trailing semicolon is legal
 * but would break wrapping, so it is removed before validation and execution.
 */
export function stripTrailingSemicolons(sql: string): string {
    return sql.replace(/[\s;]+$/g, '');
}

export function assertSqlLength(sql: string, maxSqlLength = MAX_SQL_LENGTH): void {
    if (!sql.trim()) {
        throw new SqlGuardError('EMPTY', 'The SQL query is empty.');
    }
    if (sql.length > maxSqlLength) {
        throw new SqlGuardError(
            'TOO_LONG',
            `The SQL query is too long (${sql.length} > ${maxSqlLength} characters).`
        );
    }
}

/** Wrap a SELECT so the database never materialises unbounded results. */
export function wrapWithRowLimit(sql: string, maxRows: number): string {
    const limit = Math.max(1, Math.floor(maxRows));
    return `SELECT * FROM (\n${sql}\n) AS _c2e_query LIMIT ${limit + 1}`;
}
