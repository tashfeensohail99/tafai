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
import { Type } from 'class-transformer';
import { FollowUpPriority, FollowUpStatus } from '@prisma/client';

/** Time buckets computed in Pakistan Standard Time (Asia/Karachi, UTC+5). */
export type FollowUpBucket = 'overdue' | 'today' | 'upcoming';

export class ListFollowUpsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;

  /**
   * Backend-computed due bucket (implies status OPEN). Mutually exclusive with
   * dueFrom/dueTo — when set, it defines the dueAt window itself.
   */
  @IsOptional()
  @IsIn(['overdue', 'today', 'upcoming'])
  bucket?: FollowUpBucket;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @IsOptional()
  @IsDateString()
  dueTo?: string;

  /** 1-based page index. When omitted (with limit), all matches are returned. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Page size; capped at 100 to bound the payload. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateFollowUpDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactMethod?: string;

  @IsDateString()
  dueAt!: string;

  @IsOptional()
  @IsEnum(FollowUpPriority)
  priority?: FollowUpPriority;
}

export class UpdateFollowUpDto {
  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactMethod?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(FollowUpPriority)
  priority?: FollowUpPriority;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;
}

export class CompleteFollowUpDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  outcomeNotes?: string;
}

export class RescheduleFollowUpDto {
  @IsDateString()
  dueAt!: string;
}