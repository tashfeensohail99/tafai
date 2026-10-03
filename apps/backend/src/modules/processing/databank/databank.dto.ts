import { Transform, Type } from 'class-transformer';
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

/**
 * PATCH files/:fileId — rename AND/OR set metadata (description, tags). Every
 * field is optional: a `fileName`-only body is a plain rename (the old
 * behaviour). An explicit `description: null` clears the description — the
 * `@ValidateIf(o.description !== null)` guard lets null through while still
 * requiring a string when a value is present. Tags are validated here (≤ 50,
 * each ≤ 64 chars) and trimmed/de-duplicated in the service.
 */
export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @ValidateIf((o) => o.description !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];
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

/**
 * Databank P3-2 file versioning. A new VERSION of an EXISTING file (same
 * direct-to-R2 flow as a first upload, minus the scope — the scope is the file's
 * own). The browser presigns a PUT into the file's scope folder, uploads the
 * bytes straight to R2, then commits.
 */
export class PresignVersionDto {
  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(0)
  fileSizeBytes!: number;

  /** Optional name — only drives the object key's extension; defaults to the
   *  file's current name. The file's own fileName is unchanged by a new version. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName?: string;
}

/** Commit a completed version upload: the `storageKey` the presign returned plus
 *  the new bytes' metadata. `sha256` gates a no-op re-upload of the CURRENT bytes. */
export class CommitVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  storageKey!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(0)
  fileSizeBytes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sha256!: string;
}

/**
 * Databank P3 PR-2 — init a resumable (> 2 GB) NEW VERSION upload for an existing
 * file (the direct presign→PUT→commit version path tops out at ~2 GB). Mirrors
 * InitUploadFileDto's per-file fields minus folderId/allowDuplicate: a version
 * always targets ONE existing file (the route :fileId) and is never deduped. The
 * scope is the file's own; the browser uploads the bytes through the resumable
 * multipart engine, then completes as usual.
 */
export class InitVersionDto {
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

  /** Lower-case hex SHA-256 of the whole file (computed in the browser). */
  @Matches(/^[0-9a-f]{64}$/, { message: 'sha256 must be 64 lower-case hex characters' })
  sha256!: string;
}

/** PATCH a version's human label ("Signed final"). */
export class RenameVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

/**
 * GET processing/databank/search — full-text/fuzzy file search with server-side
 * pagination and type facets (Databank P2). All fields arrive as query-string
 * values, so booleans/numbers are coerced (the global ValidationPipe runs with
 * `transform` + `enableImplicitConversion`, and `forbidNonWhitelisted`, so every
 * accepted field must be declared here). Scope is EITHER `clientId` OR
 * `personal: true` — exactly one, enforced in the service.
 */
export class SearchDatabankDto {
  /** Client-scoped search. Omit when `personal` is set. */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Search the caller's personal databank instead of a client's. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  personal?: boolean;

  /** Free-text query (fileName + description + tags). Empty = list, no ranking. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Folder to scope to; 'null'/'root'/'' = the databank root; omit = any folder. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  folderId?: string;

  /** Comma-separated type buckets (image,pdf,video,audio,office,other). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  types?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

/**
 * GET {base}/databank/trash — the TOP-LEVEL trashed items in ONE scope (Databank
 * P3). Scope is EITHER `clientId` OR `personal: true` — exactly one, enforced in
 * the service. Query-string values, so `personal` is coerced like SearchDatabankDto;
 * forbidNonWhitelisted means only these two fields are accepted.
 */
export class TrashQueryDto {
  /** Client-scoped trash. Omit when `personal` is set. */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** The caller's personal databank trash instead of a client's. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  personal?: boolean;
}
