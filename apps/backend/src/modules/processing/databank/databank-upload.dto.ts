import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * DTOs for resumable databank uploads (Databank Phase 1 —
 * docs/databank-phase1-resumable-uploads.md). The browser hashes each file,
 * INITs sessions in batches, PUTs parts straight to R2 with presigned URLs, then
 * COMPLETEs. The global ValidationPipe runs whitelist + forbidNonWhitelisted +
 * transform, so nested items need @Type and every field must be declared.
 */

/** Max files per init / ids per complete — keeps each request bounded. */
export const MAX_UPLOAD_BATCH = 50;
/** Max part URLs signed per request. */
export const MAX_SIGN_PARTS = 100;

export class InitUploadFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  /** Whole-file size in bytes (a JS number — exact far beyond any file). */
  @IsInt()
  @Min(0)
  sizeBytes!: number;

  /** File.lastModified (epoch ms) — lets a re-dropped file match its session. */
  @IsOptional()
  @IsInt()
  lastModified?: number;

  /** Path inside a dropped folder, e.g. "Passport/scan.pdf". */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  relativePath?: string;

  /** Lower-case hex SHA-256 of the whole file (computed in the browser). */
  @Matches(/^[0-9a-f]{64}$/, { message: 'sha256 must be 64 lower-case hex characters' })
  sha256!: string;

  /** Upload even if an identical file already exists elsewhere in the scope. */
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;

  /** Per-file destination folder (overrides the batch folderId); null = root. */
  @IsOptional()
  @ValidateIf((o) => o.folderId !== null)
  @IsUUID()
  folderId?: string | null;
}

export class InitUploadsDto {
  /** Client-scoped upload. Omit when `personal` is set. */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Upload into the caller's personal databank instead of a client's. */
  @IsOptional()
  @IsBoolean()
  personal?: boolean;

  /** Default destination folder for the batch; omit / null = the scope root. */
  @IsOptional()
  @ValidateIf((o) => o.folderId !== null)
  @IsUUID()
  folderId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_UPLOAD_BATCH)
  @ValidateNested({ each: true })
  @Type(() => InitUploadFileDto)
  files!: InitUploadFileDto[];
}

export class SignPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SIGN_PARTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers!: number[];
}

export class CompleteUploadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_UPLOAD_BATCH)
  @IsUUID('all', { each: true })
  ids!: string[];
}
