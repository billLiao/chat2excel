import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const testDir = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-db-test-${process.pid}`
);

vi.mock('electron', () => ({
    app: {
        getPath: () => testDir,
    },
}));

import { db } from '../electron/db';
import { SqlGuardError } from '../electron/agent/sql-guard';

beforeAll(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    await db.init();
});

afterAll(async () => {
    await db.close();
    // DuckDB can release the file handle a moment after close() resolves.
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
});

let salesTable = '';

describe('database query pipeline', () => {
    it('imports a CSV with typed columns and aggregates it', async () => {
        const csvPath = `${testDir}/sales.csv`;
        fs.writeFileSync(
            csvPath,
            [
                'region,amount,ordered_at',
                '华东,100.5,2024-01-01',
                '华东,49.5,2024-01-02',
                '华南,200,2024-01-03',
            ].join('\n'),
            'utf-8'
        );

        const summary = await db.importFileDetailed(csvPath);
        const tableName = summary.sheets[0].tableName;
        salesTable = tableName;
        const types = Object.fromEntries(
            summary.sheets[0].columns.map((column) => [column.name, column.type])
        );
        expect(types.amount).toBe('DOUBLE');
        expect(types.ordered_at).toBe('DATE');

        const artifact = await db.query(
            `SELECT region, SUM(amount) AS total FROM "${tableName}" GROUP BY region ORDER BY total DESC`
        );
        expect(artifact.columns.map((column) => column.name)).toEqual(['region', 'total']);
        expect(artifact.rows).toEqual([
            ['华南', 200],
            ['华东', 150],
        ]);
        expect(artifact.tables).toEqual([tableName.toLowerCase()]);
    });

    it('caps rows, marks truncation and serves pages', async () => {
        const artifact = await db.query(
            `SELECT region, amount FROM "${salesTable}" ORDER BY amount DESC`,
            { maxRows: 2 }
        );
        expect(artifact.rows).toHaveLength(2);
        expect(artifact.truncated).toBe(true);

        const page = db.getQueryPage(artifact.id, 1, 2);
        expect(page.rows.map((row) => row.amount)).toEqual([100.5]);
        expect(page.limit).toBe(2);
    });

    it('counts rows and profiles columns with DuckDB SUMMARIZE', async () => {
        const counts = await db.getTableRowCounts([salesTable]);
        expect(counts[salesTable]).toBe(3);

        const profile = await db.getTableProfile(salesTable, 2);
        expect(profile.tableName).toBe(salesTable);
        expect(profile.rowCount).toBe(3);
        expect(profile.sampleRows).toHaveLength(2);
        expect(profile.truncatedSample).toBe(true);

        const amount = profile.columns.find((column) => column.name === 'amount')!;
        expect(amount.type).toBe('DOUBLE');
        expect(amount.min).toBe(49.5);
        expect(amount.max).toBe(200);
        expect(amount.nullPercentage).toBe(0);
        expect(amount.approxUnique).toBe(3);

        const region = profile.columns.find((column) => column.name === 'region')!;
        expect(region.type).toBe('VARCHAR');
        expect(region.approxUnique).toBe(2);
    });

    it('rejects writes and file readers at the database boundary', async () => {
        await expect(db.query('DROP TABLE sales')).rejects.toBeInstanceOf(SqlGuardError);
        await expect(
            db.query("SELECT * FROM read_csv('C:/Windows/win.ini')")
        ).rejects.toBeInstanceOf(SqlGuardError);
        await expect(
            db.query("SELECT * FROM 'C:/Windows/win.ini'")
        ).rejects.toBeInstanceOf(SqlGuardError);
    });
});
