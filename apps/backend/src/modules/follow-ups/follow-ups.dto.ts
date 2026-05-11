import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { FollowUpPriority, FollowUpStatus } from '@prisma/client';

export class ListFollowUpsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;

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