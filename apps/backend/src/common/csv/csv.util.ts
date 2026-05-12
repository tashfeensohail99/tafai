import type { Response } from 'express';

/**
 * Render an array of rows as a CSV string. Rows can have any shape; the
 * `columns` array decides the column order, header label, and how each row's
 * value is derived. Values that are null/undefined render as empty strings.
 *
 * The renderer follows RFC 4180: every field is quoted, embedded quotes are
 * doubled, embedded newlines are preserved inside the quoted field. Excel,
 * Google Sheets, and any RFC-compliant parser all open the output cleanly.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | Date | null | undefined;
}

export function rowsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (raw: unknown): string => {
    if (raw === null || raw === undefined) return '""';
    let s: string;
    if (raw instanceof Date) s = raw.toISOString();
    else if (typeof raw === 'boolean') s = raw ? 'true' : 'false';
    else s = String(raw);
    s = s.replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines: string[] = [];
  lines.push(columns.map((c) => escape(c.header)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => escape(c.value(row))).join(','));
  }
  // \r\n line terminator is what Excel-on-Windows expects; RFC 4180 also
  // mandates it. Other parsers accept it too.
  return lines.join('\r\n') + '\r\n';
}

/**
 * Stream a CSV string back as a downloadable attachment. The filename should
 * be a slug; the caller decides what to put in front (resource name + date).
 */
export function sendCsvDownload(res: Response, filename: string, csv: string): void {
  // Prepend a UTF-8 BOM so Excel auto-detects encoding for non-ASCII names.
  const body = '﻿' + csv;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

/** ISO 8601 date prefix, useful for filenames: "2026-05-12". */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
