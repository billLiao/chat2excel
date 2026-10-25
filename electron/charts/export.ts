/**
 * Export helpers for charts and dashboards.
 *
 * The renderer collects PNG dataURLs (ECharts) and pre-rendered HTML fragments
 * (KPI/table charts); this module turns them into a CSV string or a standalone
 * HTML snapshot that the main process writes to a user-chosen file.
 */

import type { ChartColumn, DashboardExportSection } from '../../src/lib/charts/types';

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    let text: string;
    if (value instanceof Date) text = value.toISOString();
    else if (typeof value === 'object') text = JSON.stringify(value);
    else text = String(value);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * RFC 4180 CSV (with a BOM so Excel detects UTF-8). `rows` are objects keyed
 * by the column names, matching ChartPayload.rows.
 */
export function buildChartCsv(
    columns: ChartColumn[],
    rows: Record<string, unknown>[],
    options: { maxRows?: number } = {}
): string {
    const limit =
        typeof options.maxRows === 'number' && options.maxRows > 0
            ? options.maxRows
            : rows.length;
    const lines: string[] = [];
    lines.push(columns.map((column) => csvCell(column.name)).join(','));
    for (const row of rows.slice(0, limit)) {
        lines.push(columns.map((column) => csvCell(row[column.name])).join(','));
    }
    return `\ufeff${lines.join('\r\n')}`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTimestamp(value: number): string {
    return new Date(value).toLocaleString();
}

/**
 * A standalone, dependency-free HTML snapshot of a dashboard. PNG sections are
 * embedded as data URLs so the file opens correctly offline.
 */
export function buildDashboardHtml(
    meta: { name: string; exportedAt: number; filterNote?: string },
    sections: DashboardExportSection[]
): string {
    const body = sections
        .map((section) => {
            const title = escapeHtml(section.title || '');
            const subtitle = section.subtitle
                ? `<p class="meta">${escapeHtml(section.subtitle)}</p>`
                : '';
            const metaLine = section.meta ? `<p class="meta">${escapeHtml(section.meta)}</p>` : '';
            const content =
                section.kind === 'png' && section.image
                    ? `<img class="chart" src="${section.image}" alt="${title}" />`
                    : section.html
                      ? `<div class="fragment">${section.html}</div>`
                      : '<p class="meta">（此图表没有可导出的内容）</p>';
            return `<section><h2>${title}</h2>${subtitle}${content}${metaLine}</section>`;
        })
        .join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(meta.name)} - Chat2Excel 仪表盘导出</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 32px auto; max-width: 1100px; color: #1f2937; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .header-meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; }
  section { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; page-break-inside: avoid; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 11px; margin: 2px 0 8px; }
  img.chart { max-width: 100%; height: auto; }
  .fragment table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .fragment th, .fragment td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; }
  .fragment th { background: #f9fafb; }
</style>
</head>
<body>
<h1>${escapeHtml(meta.name)}</h1>
<div class="header-meta">
  导出时间：${escapeHtml(formatTimestamp(meta.exportedAt))} · 共 ${sections.length} 个图表${
      meta.filterNote ? ` · ${escapeHtml(meta.filterNote)}` : ''
  }
</div>
${body}
</body>
</html>`;
}
