import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LeadImportStatus } from '@prisma/client';

/**
 * multipart/form-data can't carry nested objects natively — the frontend
 * JSON.stringify's the column mapping into a single form field. This
 * transform unwraps it before class-validator runs ValidateNested against
 * the ColumnMappingDto shape.
 */
function parseJsonField<T>(value: unknown): T | unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Mapping from canonical lead field → spreadsheet column header.
 * Only `phone` is required; everything else is optional. Admin fills this
 * in via the preview UI before triggering the actual import.
 */
export class ColumnMappingDto {
  @IsString() phone!: string;

  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() alternatePhone?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() targetCountry?: string;
  @IsOptional() @IsString() serviceInterest?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() sourceLabel?: string;
}

export class StartImportDto {
  @IsString() @MaxLength(120) name!: string;

  // multipart sends columnMapping as a JSON-encoded string — unwrap it
  // before nested validation, otherwise class-validator complains
  // "nested property columnMapping must be either object or array".
  @Transform(({ value }) => parseJsonField<unknown>(value))
  @ValidateNested()
  @Type(() => ColumnMappingDto)
  columnMapping!: ColumnMappingDto;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  defaultCountry?: string;

  // Repeated form fields land as an array via multer; a single field
  // arrives as a string. Coerce so class-validator's @IsArray is happy.
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return [value];
    return [];
  })
  @IsArray()
  @IsUUID('4', { each: true })
  selectedAgentIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  welcomeMessage?: string;
}

export class ListBatchesQueryDto {
  @IsOptional()
  @IsEnum(LeadImportStatus)
  status?: LeadImportStatus;

  @IsOptional()
  @IsString()
  search?: string;
}

export class PreviewResultDto {
  /** Detected column headers (row 1 of the file). */
  headers!: string[];
  /** First N rows (typically 10) for the admin to verify the parse looks right. */
  sampleRows!: Array<Record<string, string>>;
  /** Total data rows in the file (excluding header). */
  totalRows!: number;
  /** Best-guess column mapping based on header names matching common patterns. */
  suggestedMapping!: Partial<Record<keyof ColumnMappingDto, string>>;
  sourceFormat!: 'csv' | 'xlsx';
}
