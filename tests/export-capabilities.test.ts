import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const testDir = vi.hoisted(
    () =>
        `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/chat2excel-export-test-${process.pid}`
);

vi.mock('electron', () => ({
    app: {
        getPath: () => testDir,
    },
}));

import {
    exportQueryToDirectory,
    sanitizeExportName,
    writeQueryExport,
} from '../electron/capabilities/excel';
import type { QueryArtifact } from '../electron/agent/result-store';

const artifact: QueryArtifact = {
    id: 'q_test',
    sql: 'SELECT region, amount, note FROM sales',
    tables: ['sales'],
    columns: [
        { name: 'region', type: 'VARCHAR' },
        { name: 'amount', type: 'DOUBLE' },
        { name: 'note', type: 'VARCHAR' },
    ],
    rows: [
        ['华东', 100.5, '=SUM(A1:A2)'],
        ['华南', 200, null],
        ['华东', 49.5, '@cmd'],
    ],
    rowCount: 3,
    truncated: false,
    elapsedMs: 2,
    createdAt: Date.now(),
};

beforeAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
});

describe('Excel/CSV export capability', () => {
    it('writes a formatted xlsx from an artifact', async () => {
        const filePath = path.join(testDir, 'result.xlsx');
        const result = await writeQueryExport(artifact, filePath);
        expect(result.format).toBe('xlsx');
        expect(result.rowCount).toBe(3);
        expect(result.fileName).toBe('result.xlsx');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.getWorksheet('Result')!;
        expect(sheet.getRow(1).getCell(1).value).toBe('region');
        expect(sheet.getRow(1).font.bold).toBe(true);
        expect(sheet.autoFilter).toBeTruthy();
        expect(sheet.views[0].state).toBe('frozen');
        expect(sheet.getRow(2).getCell(1).value).toBe('华东');
        expect(sheet.getRow(2).getCell(2).value).toBe(100.5);
        expect(sheet.getRow(3).getCell(3).value).toBeNull();
    });

    it('infers csv from the extension and neutralizes formulas', async () => {
        const filePath = path.join(testDir, 'result.csv');
        const result = await writeQueryExport(artifact, filePath);
        expect(result.format).toBe('csv');

        const text = fs.readFileSync(filePath, 'utf8');
        expect(text.startsWith('\uFEFF')).toBe(true);
        expect(text).toContain('region,amount,note');
        expect(text).toContain("华东,100.5,'=SUM(A1:A2)");
        expect(text).toContain("华东,49.5,'@cmd");
        expect(text).toContain('华南,200,');
    });

    it('sanitizes agent-provided filenames and never overwrites', async () => {
        expect(sanitizeExportName('  sales/2024  ')).toBe('sales-2024');
        expect(sanitizeExportName('..\\..\\secret')).toBe('secret');
        expect(sanitizeExportName('')).toBe('chat2excel-export');

        const first = await exportQueryToDirectory(artifact, {
            filename: 'sales/2024',
            format: 'xlsx',
            directory: testDir,
        });
        expect(first.fileName).toBe('sales-2024.xlsx');
        expect(path.dirname(first.filePath)).toBe(path.resolve(testDir));

        const second = await exportQueryToDirectory(artifact, {
            filename: 'sales/2024',
            format: 'xlsx',
            directory: testDir,
        });
        expect(second.fileName).toBe('sales-2024-2.xlsx');
        expect(fs.existsSync(first.filePath)).toBe(true);
        expect(fs.existsSync(second.filePath)).toBe(true);

        const withExtension = await exportQueryToDirectory(artifact, {
            filename: 'report.csv.xlsx',
            format: 'xlsx',
            directory: testDir,
        });
        expect(withExtension.fileName).toBe('report.csv.xlsx');
    });
});
