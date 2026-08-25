/**
 * 结果集导出 CSV（P1-2）。
 * - 字段含逗号 / 引号 / 换行时按 RFC 4180 转义。
 * - 前置 UTF-8 BOM，保证 Excel 正确识别中文。
 */

/** 将单元格值转义为 CSV 字段。 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 由列名与行数据生成 CSV 文本。 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(escapeCell).join(',');
  const body = rows
    .map((row) => columns.map((col) => escapeCell(row[col])).join(','))
    .join('\r\n');
  return `﻿${header}\r\n${body}`;
}

/** 触发浏览器下载 CSV 文件。 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
