/**
 * Database capability layer.
 *
 * The agent tools and the IPC handlers both go through this module, so the
 * guard rails (read-only SQL, table allow-list, row caps) and the artifact
 * contract are defined exactly once.
 */

import { db, type TableProfile } from '../db';
import {
    queryResults,
    type QueryArtifact,
    type QueryPage,
    type QueryPreview,
} from '../agent/result-store';

export interface TableCatalogEntry {
    name: string;
    displayName: string;
    description: string;
    rowCount: number;
}

export interface TableDescription {
    name: string;
    displayName: string;
    description: string;
    columns: { name: string; type: string; description: string }[];
    profile: TableProfile;
}

export interface RunQueryOptions {
    /** Tables selected in the chat context; omitted means every imported table. */
    contextTables?: string[];
    maxRows?: number;
    timeoutMs?: number;
}

function allowedSet(contextTables?: string[]): Set<string> | null {
    if (!contextTables || contextTables.length === 0) return null;
    return new Set(contextTables.map((name) => name.toLowerCase()));
}

function isAllowed(name: string, allowed: Set<string> | null): boolean {
    return !allowed || allowed.has(name.toLowerCase());
}

/**
 * Catalog for the agent: names, display names, descriptions and row counts.
 * Tables outside the current chat context are filtered out entirely.
 */
export async function listTables(contextTables?: string[]): Promise<TableCatalogEntry[]> {
    const allowed = allowedSet(contextTables);
    const tables = (await db.getTables()).filter((table) => isAllowed(table.name, allowed));
    if (tables.length === 0) return [];

    const counts = await db.getTableRowCounts(tables.map((table) => table.name));
    return tables.map((table) => ({
        ...table,
        rowCount: counts[table.name] ?? 0,
    }));
}

export async function describeTable(
    tableName: string,
    contextTables?: string[],
    sampleLimit = 8
): Promise<TableDescription> {
    const allowed = allowedSet(contextTables);
    if (!isAllowed(tableName, allowed)) {
        throw new Error(
            `Table "${tableName}" is not part of this conversation. Use list_tables to see the available tables.`
        );
    }

    const tables = await db.getTables();
    const meta = tables.find((table) => table.name.toLowerCase() === tableName.toLowerCase());
    if (!meta) {
        throw new Error(`Unknown table "${tableName}". Use list_tables to see the available tables.`);
    }

    const [columns, profile] = await Promise.all([
        db.getTableColumns(meta.name),
        db.getTableProfile(meta.name, sampleLimit),
    ]);

    return {
        name: meta.name,
        displayName: meta.displayName,
        description: meta.description,
        columns,
        profile,
    };
}

/**
 * Execute a guarded read-only query and return both the stored artifact and a
 * preview that is safe to send to the model.
 */
export async function runQuery(
    sql: string,
    options: RunQueryOptions = {}
): Promise<{ artifact: QueryArtifact; preview: QueryPreview }> {
    const artifact = await db.query(sql, {
        maxRows: options.maxRows ?? 2_000,
        timeoutMs: options.timeoutMs ?? 30_000,
        allowedTables: options.contextTables?.length ? options.contextTables : undefined,
    });
    return {
        artifact,
        preview: queryResults.preview(artifact.id, 50),
    };
}

export function getQueryPreview(queryId: string, limit = 50): QueryPreview {
    return queryResults.preview(queryId, limit);
}

export function getQueryPage(queryId: string, offset: number, limit: number): QueryPage {
    return queryResults.page(queryId, offset, limit);
}
