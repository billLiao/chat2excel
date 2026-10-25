/**
 * Dashboard filter pushdown.
 *
 * A dashboard filter is applied as an outer WHERE over the saved query's
 * OUTPUT columns: `SELECT * FROM (saved_sql) AS _filtered WHERE ...`. A chart
 * only reacts to a filter when its result actually contains the filter column,
 * which is verified against DESCRIBE output before the condition is built.
 *
 * Identifier names are resolved against the described columns and rendered as
 * quoted identifiers; values are rendered as escaped literals (or plain
 * numbers for numeric columns), so neither side can inject SQL.
 */

import type { DashboardFilter } from '../../src/lib/charts/types';

export interface DescribedColumn {
    column_name: string;
    column_type: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CATEGORY_VALUES = 100;
const MAX_VALUE_LENGTH = 200;

export function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/** Render an escaped SQL literal. Numbers and ISO dates stay unquoted casts. */
export function sqlLiteral(value: unknown, columnType?: string): string {
    const type = (columnType || '').toUpperCase();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'bigint') return String(value);

    const text = String(value);
    if (type.includes('INT') || type.includes('DOUBLE') || type.includes('DECIMAL') || type.includes('FLOAT') || type.includes('REAL')) {
        const parsed = Number(text);
        if (Number.isFinite(parsed)) return String(parsed);
    }
    return `'${text.replace(/'/g, "''")}'`;
}

/** Resolve a filter column against the described output columns (case-insensitive). */
export function resolveColumn(
    filter: DashboardFilter,
    described: DescribedColumn[]
): DescribedColumn | null {
    const wanted = filter.column?.trim().toLowerCase();
    if (!wanted) return null;
    return (
        described.find(
            (column) => column.column_name.toLowerCase() === wanted
        ) || null
    );
}

/**
 * Build the WHERE condition for one filter, or null when the filter cannot be
 * applied (unknown column, empty values, malformed dates).
 */
export function filterCondition(
    filter: DashboardFilter,
    described: DescribedColumn[]
): string | null {
    const column = resolveColumn(filter, described);
    if (!column) return null;
    const type = (column.column_type || '').toUpperCase();
    const isDateType = type.includes('DATE') || type.includes('TIME');

    if (filter.kind === 'date-range') {
        const conditions: string[] = [];
        const identifier = quoteIdentifier(column.column_name);
        const cast = (value: string) =>
            isDateType
                ? `CAST(${sqlLiteral(value)} AS DATE)`
                : sqlLiteral(value);
        if (filter.from && ISO_DATE_PATTERN.test(filter.from)) {
            conditions.push(`${identifier} >= ${cast(filter.from)}`);
        }
        if (filter.to && ISO_DATE_PATTERN.test(filter.to)) {
            conditions.push(`${identifier} <= ${cast(filter.to)}`);
        }
        if (conditions.length === 0) return null;
        return conditions.join(' AND ');
    }

    const values = (filter.values || [])
        .filter(
            (value) =>
                typeof value === 'string' &&
                value.length > 0 &&
                value.length <= MAX_VALUE_LENGTH
        )
        .slice(0, MAX_CATEGORY_VALUES);
    if (values.length === 0) return null;
    const literals = values.map((value) => sqlLiteral(value, column.column_type));
    return `${quoteIdentifier(column.column_name)} IN (${literals.join(', ')})`;
}

/**
 * Wrap the saved SQL with the filters that can actually be applied.
 *
 * Returns the filtered SQL plus per-filter status so the UI can surface which
 * filters affected the chart. Throws when DuckDB refuses the base query.
 */
export async function applyFiltersToSql(
    baseSql: string,
    filters: DashboardFilter[],
    describe: (sql: string) => Promise<DescribedColumn[]>
): Promise<{ sql: string; applied: string[]; skipped: string[] }> {
    const usable = (filters || []).filter(
        (filter) =>
            filter &&
            (filter.kind === 'date-range' || filter.kind === 'category') &&
            typeof filter.column === 'string'
    );
    if (usable.length === 0) {
        return { sql: baseSql, applied: [], skipped: [] };
    }

    const described = await describe(`DESCRIBE SELECT * FROM (${baseSql}) AS _filters_base`);
    const applied: string[] = [];
    const skipped: string[] = [];
    const conditions: string[] = [];
    for (const filter of usable) {
        const condition = filterCondition(filter, described);
        if (condition) {
            conditions.push(condition);
            applied.push(filter.column);
        } else {
            skipped.push(filter.column);
        }
    }
    if (conditions.length === 0) {
        return { sql: baseSql, applied: [], skipped };
    }
    return {
        sql: `SELECT * FROM (${baseSql}) AS _filters_base WHERE ${conditions.join(' AND ')}`,
        applied,
        skipped,
    };
}

/** Stable cache key contribution for a filter set. */
export function filterCacheKey(filters?: DashboardFilter[]): string {
    if (!filters || filters.length === 0) return '';
    const normalized = [...filters]
        .map((filter) => ({
            kind: filter.kind,
            column: (filter.column || '').toLowerCase(),
            from: filter.from || '',
            to: filter.to || '',
            values: [...(filter.values || [])].sort(),
        }))
        .sort((a, b) => a.column.localeCompare(b.column) || a.kind.localeCompare(b.kind));
    return JSON.stringify(normalized);
}
