import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateWhatsAppSettingsDto {
  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;

  @IsOptional() @Matches(HHMM, { message: 'hoursOpen must be HH:MM' })
  hoursOpen?: string;

  @IsOptional() @Matches(HHMM, { message: 'hoursClose must be HH:MM' })
  hoursClose?: string;

  // Empty string clears the break; otherwise HH:MM.
  @IsOptional() @Matches(/^$|^([01]\d|2[0-3]):[0-5]\d$/, { message: 'breakStart must be HH:MM or empty' })
  breakStart?: string;

  @IsOptional() @Matches(/^$|^([01]\d|2[0-3]):[0-5]\d$/, { message: 'breakEnd must be HH:MM or empty' })
  breakEnd?: string;

  // 0 = Sunday .. 6 = Saturday.
  @IsOptional() @IsArray() @ArrayMaxSize(7)
  @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  workingDays?: number[];

  // Response-SLA target: 30s – 24h.
  @IsOptional() @IsInt() @Min(30) @Max(86_400)
  slaResponseSeconds?: number;

  // Warn-before window: 0 – 1h.
  @IsOptional() @IsInt() @Min(0) @Max(3_600)
  slaWarnBeforeSeconds?: number;

  @IsOptional() @IsInt() @Min(1) @Max(1_000)
  slaReassignThreshold?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  slaHandoverBonus?: number;

  @IsOptional() @IsBoolean()
  autoAckEnabled?: boolean;

  @IsOptional() @IsString() @MaxLength(2_000)
  autoAckTemplate?: string;

  @IsOptional() @IsString() @MaxLength(2_000)
  afterHoursTemplate?: string;
}
