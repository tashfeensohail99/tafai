import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

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
