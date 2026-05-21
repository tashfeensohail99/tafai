import { Injectable } from '@nestjs/common';
import { parseSpreadsheet } from './parsers/spreadsheet-parser';
import type { PreviewResultDto, ColumnMappingDto } from './lead-imports.dto';

/**
 * Header-name heuristics for the preview's "suggested mapping". We look at
 * each canonical lead field and pick the first header whose lower-cased
 * form contains any of the keywords below. Admin can override before they
 * trigger the actual import.
 */
const HEADER_HEURISTICS: Record<keyof ColumnMappingDto, string[]> = {
  phone: ['phone', 'mobile', 'whatsapp', 'cell', 'contact number', 'number'],
  firstName: ['first name', 'firstname', 'fname', 'name'],
  lastName: ['last name', 'lastname', 'lname', 'surname'],
  email: ['email', 'e-mail', 'mail'],
  alternatePhone: ['alternate', 'secondary phone', 'alt phone', 'other phone'],
  nationality: ['nationality', 'citizen'],
  targetCountry: ['target country', 'country of interest', 'destination', 'country'],
  serviceInterest: ['service', 'interested service', 'visa type', 'product'],
  city: ['city', 'town', 'location'],
  notes: ['notes', 'remarks', 'comment', 'description'],
  sourceLabel: ['source', 'campaign', 'channel'],
};

@Injectable()
export class LeadImportsService {
  /**
   * Read-only parse of an uploaded file. Returns the header row + first 10
   * data rows + a best-guess column mapping for the admin's review screen.
   * Nothing is persisted; this endpoint is safe to call repeatedly while
   * the admin tweaks the mapping.
   */
  preview(file: { buffer: Buffer; mimetype: string; originalname: string }): PreviewResultDto {
    const parsed = parseSpreadsheet(file.buffer, file.mimetype, file.originalname);
    const sampleRows = parsed.rows.slice(0, 10);

    const suggested: Partial<Record<keyof ColumnMappingDto, string>> = {};
    const lowerHeaders = parsed.headers.map((h) => h.toLowerCase());
    for (const field of Object.keys(HEADER_HEURISTICS) as Array<keyof ColumnMappingDto>) {
      const keywords = HEADER_HEURISTICS[field];
      const matchIdx = lowerHeaders.findIndex((h) =>
        keywords.some((kw) => h === kw || h.includes(kw)),
      );
      if (matchIdx >= 0) {
        suggested[field] = parsed.headers[matchIdx];
      }
    }

    return {
      headers: parsed.headers,
      sampleRows,
      totalRows: parsed.totalRows,
      suggestedMapping: suggested,
      sourceFormat: parsed.sourceFormat,
    };
  }
}
