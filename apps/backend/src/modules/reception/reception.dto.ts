import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VisitStatus, VisitType } from '@prisma/client';

/** Front-desk quick lookup — match an existing lead or client by phone or name. */
export class LookupQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(60)
  q!: string;
}

export class ListVisitsQueryDto {
  /** PKT day, YYYY-MM-DD. Defaults to today (Pakistan time) when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date?: string;

  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @IsOptional()
  @IsEnum(VisitType)
  type?: VisitType;
}

export class CreateVisitDto {
  @IsEnum(VisitType)
  visitType!: VisitType;

  /** Full name as the desk keys it (split into first/last only when we spin up a Lead). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Link to a known lead / client instead of creating a new one. */
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Whom they came to see. */
  @IsOptional()
  @IsUUID()
  hostEmployeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateVisitDto {
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @IsOptional()
  @IsUUID()
  hostEmployeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
