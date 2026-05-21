import { Type } from 'class-transformer';
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

  @ValidateNested()
  @Type(() => ColumnMappingDto)
  columnMapping!: ColumnMappingDto;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  defaultCountry?: string;

  @IsOptional()
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
