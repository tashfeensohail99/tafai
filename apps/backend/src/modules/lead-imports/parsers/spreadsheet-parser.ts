import { BadRequestException } from '@nestjs/common';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/**
 * Parsed spreadsheet — the shape the rest of the lead-import pipeline
 * consumes regardless of whether the source was CSV or XLSX/XLS.
 */
export interface ParsedSpreadsheet {
  /** Column headers as they appeared in the source (row 1), in order. */
  headers: string[];
  /** All data rows. Each row is a `header → cell-value` object. */
  rows: Array<Record<string, string>>;
  /** Total data rows (rows.length, kept for clarity in API responses). */
  totalRows: number;
  /** Source format we ended up parsing as — useful for the UI. */
  sourceFormat: 'csv' | 'xlsx';
}

const MAX_ROWS = 50_000; // Hard cap. Files larger than this should be split.

export function parseSpreadsheet(
  buffer: Buffer,
  mimeType: string,
  originalFileName: string,
): ParsedSpreadsheet {
  const ext = (originalFileName.split('.').pop() ?? '').toLowerCase();
  const looksLikeCsv =
    mimeType === 'text/csv' ||
    mimeType === 'application/csv' ||
    mimeType === 'text/plain' ||
    ext === 'csv';
  const looksLikeXlsx =
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls';

  if (looksLikeCsv) return parseCsv(buffer);
  if (looksLikeXlsx) return parseXlsx(buffer);

  throw new BadRequestException(
    `Unsupported file type. Got mimeType="${mimeType}", filename="${originalFileName}". ` +
      `Use .csv, .xlsx, or .xls.`,
  );
}

function parseCsv(buffer: Buffer): ParsedSpreadsheet {
  // Strip a UTF-8 BOM if present — Excel writes one and PapaParse will
  // otherwise treat it as the first character of header[0].
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy', // drop blank lines and rows that are all empty cells
    transformHeader: (h) => h.trim(),
    transform: (value) => (typeof value === 'string' ? value.trim() : value),
  });

  if (result.errors.length > 0) {
    // Don't fail on every parse error — some are recoverable (trailing
    // comma, etc.). Surface the first few in the message but still return
    // whatever did parse. Caller decides whether to abort.
    const fatal = result.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter');
    if (fatal) {
      throw new BadRequestException(
        `CSV parse error on row ${fatal.row ?? '?'}: ${fatal.message}`,
      );
    }
  }

  const rows = result.data.filter(
    (r) => r && Object.values(r).some((v) => v && String(v).trim() !== ''),
  );
  if (rows.length > MAX_ROWS) {
    throw new BadRequestException(
      `File has ${rows.length} rows — over the ${MAX_ROWS} cap. Split it into smaller files.`,
    );
  }

  return {
    headers: result.meta.fields ?? [],
    rows,
    totalRows: rows.length,
    sourceFormat: 'csv',
  };
}

function parseXlsx(buffer: Buffer): ParsedSpreadsheet {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new BadRequestException('Spreadsheet has no sheets.');
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new BadRequestException(`Sheet "${sheetName}" not found in workbook.`);
  }

  // header: 1 returns rows as arrays so we can extract the header row
  // separately, then re-pair below. defval: '' avoids `undefined` cells.
  const arrays: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false, // get formatted strings, not raw numbers, so phones don't lose leading zeros
  });

  if (arrays.length === 0) {
    return { headers: [], rows: [], totalRows: 0, sourceFormat: 'xlsx' };
  }

  const headers = (arrays[0] as unknown[]).map((h) => String(h ?? '').trim());
  const dataRows: Array<Record<string, string>> = [];
  for (let i = 1; i < arrays.length; i += 1) {
    const row = arrays[i] as unknown[];
    const obj: Record<string, string> = {};
    let hasAny = false;
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c] ?? `col${c + 1}`;
      const val = c < row.length ? String(row[c] ?? '').trim() : '';
      if (val) hasAny = true;
      obj[key] = val;
    }
    if (hasAny) dataRows.push(obj);
  }

  if (dataRows.length > MAX_ROWS) {
    throw new BadRequestException(
      `File has ${dataRows.length} rows — over the ${MAX_ROWS} cap. Split it into smaller files.`,
    );
  }

  return {
    headers,
    rows: dataRows,
    totalRows: dataRows.length,
    sourceFormat: 'xlsx',
  };
}
