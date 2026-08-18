import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JrIntakeType, JrMatterStage } from '@prisma/client';

/**
 * Query filters for GET /jr/matters. The global ValidationPipe runs with
 * forbidNonWhitelisted, so every accepted property MUST be decorated or the
 * request 400s — do not add a bare field here.
 */
export class ListMattersQueryDto {
  @IsOptional()
  @IsEnum(JrMatterStage)
  stage?: JrMatterStage;

  @IsOptional()
  @IsEnum(JrIntakeType)
  intakeType?: JrIntakeType;

  /** Free-text over matter number, style of cause, or court file number. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}
