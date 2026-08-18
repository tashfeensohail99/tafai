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
import { JrArtifactFolder, JrArtifactType, JrIntakeType, JrMatterStage } from '@prisma/client';

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

// ---------------------------------------------------------------------------
// Artifact lifecycle DTOs (PR 2). Every property is decorated — the global
// ValidationPipe runs forbidNonWhitelisted, so an undecorated field 400s.
// ---------------------------------------------------------------------------

/** POST /jr/matters/:matterId/artifacts — create an artifact (status defaults DRAFT). */
export class CreateArtifactDto {
  @IsEnum(JrArtifactType)
  artifactType!: JrArtifactType;

  @IsEnum(JrArtifactFolder)
  folder!: JrArtifactFolder;

  @IsString()
  @MaxLength(300)
  title!: string;

  /** r.10(2) mandatory order for the Applicant's Record. Defaults to 0. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

/**
 * POST /jr/artifacts/:artifactId/counsel-review — counsel approves or requests
 * changes. `counselId` is a JrCounsel.id (validated to exist + be active).
 */
export class CounselReviewDto {
  @IsIn(['APPROVE', 'REQUEST_CHANGES'])
  decision!: 'APPROVE' | 'REQUEST_CHANGES';

  @IsUUID()
  counselId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  counselComments?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changesRequestedNote?: string;
}

/** POST /jr/artifacts/:artifactId/file — COUNSEL_APPROVED → FILED. */
export class FileArtifactDto {
  @IsString()
  @MaxLength(40)
  courtDocumentNumber!: string;

  /** Defaults to now if omitted. */
  @IsOptional()
  @IsDateString()
  filedAt?: string;

  /** Defaults to `filedAt` if omitted. */
  @IsOptional()
  @IsDateString()
  registryStampedAt?: string;
}

/** POST /jr/artifacts/:artifactId/serve — FILED → SERVED (proof is per artifact). */
export class ServeArtifactDto {
  @IsString()
  @MaxLength(200)
  servedOn!: string;

  @IsIn(['PERSONAL', 'EMAIL', 'COURIER', 'REGISTRY_EFILE'])
  serviceMethod!: string;

  /** Defaults to now if omitted. */
  @IsOptional()
  @IsDateString()
  servedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofOfServiceKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  serviceScreenshotKey?: string;
}
