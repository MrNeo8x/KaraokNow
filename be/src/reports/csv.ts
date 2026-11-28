import type { Response } from 'express';

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows Vietnamese correctly; cells starting with = + - @ are prefixed (formula injection). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + [columns.join(','), ...rows.map(row => columns.map(c => cell(row[c])).join(','))].join('\r\n') + '\r\n';
}

export function sendCsv(res: Response, filename: string, rows: Record<string, unknown>[], columns: string[]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(toCsv(rows, columns));
}
