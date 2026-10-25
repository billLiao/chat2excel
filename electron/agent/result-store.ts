/**
 * In-memory query result artifacts.
 *
 * Tool results must be traceable: the chart, the preview table, the CSV/Excel
 * export and the numbers quoted by the model all come from the same artifact.
 * Artifacts are intentionally short-lived and bounded.
 */

export interface QueryColumn {
    name: string;
    type: string;
}

export interface QueryArtifact {
    id: string;
    sql: string;
    tables: string[];
    columns: QueryColumn[];
    /** Row-major values, aligned with `columns`. */
    rows: unknown[][];
    /** Total number of rows returned (may exceed `rows.length` if capped). */
    rowCount: number;
    truncated: boolean;
    elapsedMs: number;
    createdAt: number;
}

export interface QueryPreview {
    queryId: string;
    sql: string;
    columns: QueryColumn[];
    /** Object rows for display / model consumption. */
    rows: Record<string, unknown>[];
    rowCount: number;
    returnedRows: number;
    truncated: boolean;
    elapsedMs: number;
}

export interface QueryPage extends QueryPreview {
    offset: number;
    limit: number;
}

const MAX_ARTIFACTS = 20;
const MAX_STORED_ROWS = 200_000;
const PREVIEW_ROWS = 50;

export function normalizeValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') {
        return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(value)
            : value.toString();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

export function rowsToObjects(
    artifact: Pick<QueryArtifact, 'columns' | 'rows'>,
    offset = 0,
    limit = artifact.rows.length
): Record<string, unknown>[] {
    const end = Math.min(artifact.rows.length, offset + limit);
    const result: Record<string, unknown>[] = [];
    for (let i = offset; i < end; i++) {
        const row = artifact.rows[i];
        const object: Record<string, unknown> = {};
        artifact.columns.forEach((column, index) => {
            object[column.name] = row[index];
        });
        result.push(object);
    }
    return result;
}

export class QueryResultStore {
    private readonly artifacts = new Map<string, QueryArtifact>();

    save(input: {
        sql: string;
        tables: string[];
        columns: QueryColumn[];
        rows: unknown[][];
        rowCount: number;
        truncated: boolean;
        elapsedMs: number;
    }): QueryArtifact {
        const artifact: QueryArtifact = {
            id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            sql: input.sql,
            tables: input.tables,
            columns: input.columns,
            rows: input.rows.slice(0, MAX_STORED_ROWS).map((row) => row.map(normalizeValue)),
            rowCount: input.rowCount,
            truncated: input.truncated || input.rows.length > MAX_STORED_ROWS,
            elapsedMs: input.elapsedMs,
            createdAt: Date.now(),
        };

        this.artifacts.set(artifact.id, artifact);
        this.evictOldArtifacts();
        return artifact;
    }

    get(queryId: string): QueryArtifact | undefined {
        return this.artifacts.get(queryId);
    }

    require(queryId: string): QueryArtifact {
        const artifact = this.artifacts.get(queryId);
        if (!artifact) {
            throw new Error(
                `Query result "${queryId}" was not found or has expired. Run the query again.`
            );
        }
        return artifact;
    }

    preview(queryId: string, limit = PREVIEW_ROWS): QueryPreview {
        const artifact = this.require(queryId);
        const rows = rowsToObjects(artifact, 0, limit);
        return {
            queryId: artifact.id,
            sql: artifact.sql,
            columns: artifact.columns,
            rows,
            rowCount: artifact.rowCount,
            returnedRows: rows.length,
            truncated: artifact.truncated || artifact.rows.length > rows.length,
            elapsedMs: artifact.elapsedMs,
        };
    }

    page(queryId: string, offset: number, limit: number): QueryPage {
        const artifact = this.require(queryId);
        const safeOffset = Math.max(0, Math.floor(offset) || 0);
        const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit) || 100));
        const rows = rowsToObjects(artifact, safeOffset, safeLimit);
        return {
            queryId: artifact.id,
            sql: artifact.sql,
            columns: artifact.columns,
            rows,
            rowCount: artifact.rowCount,
            returnedRows: rows.length,
            truncated: artifact.truncated,
            elapsedMs: artifact.elapsedMs,
            offset: safeOffset,
            limit: safeLimit,
        };
    }

    clear(): void {
        this.artifacts.clear();
    }

    private evictOldArtifacts(): void {
        while (this.artifacts.size > MAX_ARTIFACTS) {
            const oldest = this.artifacts.keys().next().value;
            if (oldest === undefined) return;
            this.artifacts.delete(oldest);
        }
    }
}

export const queryResults = new QueryResultStore();
