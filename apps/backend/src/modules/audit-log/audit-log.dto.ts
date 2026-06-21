import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditAction, AuditCategory, AuditSeverity } from '@prisma/client';

// Which audit trail(s) the viewer should pull from. CENTRAL is the historical
// default (the central AuditLog table); PROCESSING / AGREEMENT bridge in the
// rich domain trails; ALL merges all three into one timeline.
export const AUDIT_SOURCES = ['CENTRAL', 'PROCESSING', 'AGREEMENT', 'ALL'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsIn(AUDIT_SOURCES)
  source?: AuditSource;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditSeverity)
  severity?: AuditSeverity;

  @IsOptional()
  @IsEnum(AuditCategory)
  category?: AuditCategory;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  outcome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(250)
  limit?: number;
}