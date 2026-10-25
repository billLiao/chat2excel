import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    importTabularFile,
    inferColumnType,
    type ImportedColumn,
    type SheetTableSink,
} from '../electron/importer';

const tempDirs: string[] = [];

function writeTempFile(name: string, content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat2excel-test-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('type inference', () => {
    it('infers common business types', () => {
        expect(inferColumnType(['1', '2', '3'])).toBe('BIGINT');
        expect(inferColumnType(['1.5', '2', '3.25'])).toBe('DOUBLE');
        expect(inferColumnType(['$1,200.50', '¥300'])).toBe('DOUBLE');
        expect(inferColumnType(['2024-01-01', '2024-02-29'])).toBe('DATE');
        expect(
            inferColumnType(['2024-01-01 10:00:00', '2024-01-02 11:30:00'])
        ).toBe('TIMESTAMP');
        expect(inferColumnType(['true', 'FALSE'])).toBe('BOOLEAN');
    });

    it('keeps leading-zero identifiers and mixed values as text', () => {
        expect(inferColumnType(['001', '002', '010'])).toBe('VARCHAR');
        expect(inferColumnType(['A-1', '2', '3'])).toBe('VARCHAR');
        expect(inferColumnType(['', '  '])).toBe('VARCHAR');
    });
});

describe('CSV import', () => {
    it('streams rows, types columns and reports a summary', async () => {
        const csv = [
            '订单号,金额,下单日期,是否退款,数量',
            '001,\"1,234.50\",2024-01-01,false,2',
            '002,89.90,2024-01-02,true,10',
            '"003","1,000.00","2024-01-03","false","3"',
        ].join('\n');
        const filePath = writeTempFile('orders.csv', csv);

        const seenColumns: ImportedColumn[] = [];
        const inserted: unknown[][] = [];
        const sink: SheetTableSink = {
            async begin({ columns }) {
                seenColumns.push(...columns);
                return {
                    tableName: 'orders',
                    async insert(rows) {
                        inserted.push(...rows);
                    },
                };
            },
        };

        const summary = await importTabularFile(filePath, sink, {
            sampleSize: 10,
            batchSize: 2,
        });

        expect(summary.rowCount).toBe(3);
        expect(summary.sheets).toHaveLength(1);
        expect(summary.sheets[0].tableName).toBe('orders');

        const byName = Object.fromEntries(seenColumns.map((column) => [column.name, column.type]));
        expect(byName['订单号']).toBe('VARCHAR');
        expect(byName['金额']).toBe('DOUBLE');
        expect(byName['下单日期']).toBe('DATE');
        expect(byName['是否退款']).toBe('BOOLEAN');
        expect(byName['数量']).toBe('BIGINT');

        expect(inserted).toHaveLength(3);
        expect(inserted[0][0]).toBe('001');
        expect(inserted[0][1]).toBe(1234.5);
        expect(inserted[0][3]).toBe(false);
        expect(inserted[2][1]).toBe(1000);
    });

    it('handles quoted newlines and CRLF', async () => {
        const csv = 'id,note\r\n1,"line one\r\nline two"\r\n2,plain\r\n';
        const filePath = writeTempFile('notes.csv', csv);
        const rows: unknown[][] = [];
        const sink: SheetTableSink = {
            async begin() {
                return {
                    tableName: 'notes',
                    async insert(batch) {
                        rows.push(...batch);
                    },
                };
            },
        };

        await importTabularFile(filePath, sink);
        expect(rows).toHaveLength(2);
        expect(rows[0][1]).toBe('line one\r\nline two');
    });
});
