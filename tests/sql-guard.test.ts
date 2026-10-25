import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
    SqlGuardError,
    validateSerializedSql,
    wrapWithRowLimit,
    stripTrailingSemicolons,
    type SerializedSql,
} from '../electron/agent/sql-guard';

const require = createRequire(import.meta.url);
const duckdb = require('duckdb');

function serialize(sql: string): Promise<SerializedSql> {
    return new Promise((resolve, reject) => {
        const db = new duckdb.Database(':memory:');
        db.all(
            'SELECT json_serialize_sql(?::VARCHAR) AS j',
            [sql],
            (error: Error | null, rows: Array<{ j: string }>) => {
                if (error) reject(error);
                else resolve(JSON.parse(rows[0].j));
                db.close();
            }
        );
    });
}

async function validate(sql: string, tables = ['sales']) {
    return validateSerializedSql(await serialize(sql), { allowedTables: tables });
}

describe('sql guard', () => {
    it('accepts a select over an allowed table', async () => {
        const sql = 'SELECT region, SUM(amount) AS total FROM sales GROUP BY region';
        const tables = await validate(sql);
        expect(tables).toContain('sales');
        expect(sql).toContain('SELECT region');
    });

    it('accepts a CTE that only reads allowed tables', async () => {
        const tables = await validate(
            'WITH t AS (SELECT region, amount FROM sales) SELECT region, SUM(amount) FROM t GROUP BY region'
        );
        expect(tables).toContain('sales');
    });

    it('rejects DML and DDL', async () => {
        for (const sql of [
            'INSERT INTO sales VALUES (1)',
            'UPDATE sales SET amount = 0',
            'DELETE FROM sales',
            'DROP TABLE sales',
            'CREATE TABLE x (a INT)',
        ]) {
            await expect(validate(sql)).rejects.toBeInstanceOf(SqlGuardError);
        }
    });

    it('rejects file readers and other table functions', async () => {
        for (const sql of [
            "SELECT * FROM read_csv('/etc/passwd')",
            "SELECT * FROM read_parquet('x.parquet')",
            "SELECT * FROM glob('*')",
            "SELECT * FROM query('SELECT 1')",
        ]) {
            await expect(validate(sql)).rejects.toBeInstanceOf(SqlGuardError);
        }
    });

    it('rejects unknown tables and schema-qualified names', async () => {
        await expect(validate('SELECT * FROM secret_sales')).rejects.toBeInstanceOf(
            SqlGuardError
        );
        await expect(validate('SELECT * FROM main.sales')).rejects.toBeInstanceOf(
            SqlGuardError
        );
    });

    it('rejects multiple statements', async () => {
        await expect(validate('SELECT * FROM sales; DROP TABLE sales')).rejects.toBeInstanceOf(
            SqlGuardError
        );
    });

    it('strips trailing semicolons and wraps the row limit', () => {
        expect(stripTrailingSemicolons('SELECT 1;;;  ')).toBe('SELECT 1');
        const wrapped = wrapWithRowLimit('SELECT * FROM sales', 100);
        expect(wrapped).toContain('AS _c2e_query LIMIT 101');
    });
});
