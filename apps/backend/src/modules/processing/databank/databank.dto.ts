import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MAX_ENSURE_PATHS } from './folder-paths';

/**
 * DTOs for the per-client databank (the Google Drive replacement).
 *
 * A note on the `*FolderId` fields: NULL is a meaningful value — it means "the
 * client's root". `@IsOptional()` skips validation when the field is absent;
 * the `@ValidateIf(x !== null)` guard then lets an explicit `null` through
 * (move-to-root) while still requiring a real UUID when a value is present.
 * The global ValidationPipe runs `forbidNonWhitelisted`, so every accepted
 * field must be declared here or the whole request 400s.
 */

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Parent folder; omit or null to create at the client's root. */
  @IsOptional()
  @ValidateIf((o) => o.parentFolderId !== null)
  @IsUUID()
  parentFolderId?: string | null;
}

export class RenameFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class MoveFolderDto {
  /** New parent; null moves the folder to the client's root. */
  @IsOptional()
  @ValidateIf((o) => o.parentFolderId !== null)
  @IsUUID()
  parentFolderId?: string | null;
}

export class RenameFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;
}

export class MoveFileDto {
  /** Target folder; null moves the file to the client's root. */
  @IsOptional()
  @ValidateIf((o) => o.folderId !== null)
  @IsUUID()
  folderId?: string | null;
}

export class CopyFileDto {
  /** Client to copy into; omit to copy within the same client. */
  @IsOptional()
  @IsUUID()
  targetClientId?: string;

  /** Destination folder in the target client; null / omit = that client's root. */
  @IsOptional()
  @ValidateIf((o) => o.targetFolderId !== null)
  @IsUUID()
  targetFolderId?: string | null;
}

/**
 * Direct-to-storage upload (the Google Drive migration path). The browser asks
 * the backend to PRESIGN an upload, PUTs the bytes STRAIGHT to R2 (no bytes
 * through Railway), then COMMITs the DB row. Scope is EITHER a client
 * (`clientId`) or the caller's personal area (`personal: true`) — exactly one.
 */
export class PresignUploadDto {
  /** Client-scoped upload. Omit when `personal` is set. */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Upload into the caller's personal databank instead of a client's. */
  @IsOptional()
  @IsBoolean()
  personal?: boolean;

  /** Destination folder; omit or null = the databank root. */
  @IsOptional()
  @ValidateIf((o) => o.folderId !== null)
  @IsUUID()
  folderId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(0)
  fileSizeBytes!: number;
}

/**
 * Get-or-create a dropped folder tree in ONE call (Databank Phase 1). `paths`
 * are directory paths relative to `parentFolderId` ("Passport", "Passport/Scans");
 * missing ancestors are created too, and existing same-name folders are REUSED
 * (never "(2)"). Scope is a client (`clientId`) or `personal: true`.
 */
export class EnsureFolderPathsDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsBoolean()
  personal?: boolean;

  /** Where the tree is dropped; omit or null = the databank root. */
  @IsOptional()
  @ValidateIf((o) => o.parentFolderId !== null)
  @IsUUID()
  parentFolderId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENSURE_PATHS)
  @IsString({ each: true })
  @MaxLength(4096, { each: true })
  paths!: string[];
}

/** Commit a completed direct upload: the same scope as the presign, plus the
 *  `storageKey` the presign returned. */
export class CommitUploadDto extends PresignUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  storageKey!: string;
}
