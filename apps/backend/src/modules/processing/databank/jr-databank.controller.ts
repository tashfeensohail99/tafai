import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { AuditDocumentAccess } from '../../../common/decorators/audit-document-access.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { DatabankService } from './databank.service';
import { DatabankUploadService } from './databank-upload.service';
import { CompleteUploadsDto, InitUploadsDto, SignPartsDto } from './databank-upload.dto';
import {
  CommitUploadDto,
  CommitVersionDto,
  CopyFileDto,
  CreateFolderDto,
  EnsureFolderPathsDto,
  MoveFileDto,
  MoveFolderDto,
  PresignUploadDto,
  PresignVersionDto,
  RenameFolderDto,
  RenameVersionDto,
  SearchDatabankDto,
  TrashQueryDto,
  UpdateFileDto,
} from './databank.dto';

/** Query folderId → the service's `string | null | undefined`: 'null'/'root'/''
 *  mean the databank root; an absent param means "any folder". */
function parseFolderId(v?: string): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim().toLowerCase();
  if (t === '' || t === 'null' || t === 'root') return null;
  return v;
}

/**
 * JR view onto the SAME per-client databank the Processing team uses. A JR
 * matter carries a clientId (often a client escalated FROM Processing), so the
 * JR associate needs the escalated client's application documents. Every handler
 * DELEGATES to the shared DatabankService; access is enforced inside the service
 * (assertClientAccess grants jr.matter.view_all + assigned-associate paths).
 *
 * The cross-client landing (GET clients, GET clients/by-associate) is scoped to
 * clients that have a JR MATTER — a JR head (jr.matter.view_all) sees every
 * associate's clients, a plain associate sees only their own — so the JR portal
 * never lists the whole firm. Read routes use jr.portal.view; write routes use
 * jr.artifact.author.
 */
// 1 GB, disk-streamed to storage (never buffered in RAM) — see databank.controller.ts.
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB per file
const READ = 'jr.portal.view';
const WRITE = 'jr.artifact.author';

@Controller('jr/databank')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrDatabankController {
  constructor(
    private readonly databank: DatabankService,
    private readonly uploads: DatabankUploadService,
  ) {}

  // ---- Browse -------------------------------------------------------------

  /** Cross-client landing: the JR-matter clients the caller may browse (scoped
   *  in the service — head sees all, associate sees their own), each with a
   *  databank file count. */
  @Get('clients')
  @RequirePermissions(READ)
  listClients(@CurrentUser() user: RequestUser, @Query('q') q?: string) {
    return this.databank.listClientsForJr(user, q);
  }

  /** The same JR-matter clients grouped by their assigned JR associate (own
   *  group first for a head). Powers the associate-organised landing. */
  @Get('clients/by-associate')
  @RequirePermissions(READ)
  clientsByAssociate(@CurrentUser() user: RequestUser, @Query('q') q?: string) {
    return this.databank.clientsByAssociateForJr(user, q);
  }

  /** The full folder tree + files for one client. */
  @Get('clients/:clientId/tree')
  @RequirePermissions(READ)
  getTree(@Param('clientId', ParseUUIDPipe) clientId: string, @CurrentUser() user: RequestUser) {
    return this.databank.getTree(clientId, user);
  }

  /**
   * Full-text / fuzzy file search with server-side pagination + type facets,
   * over ONE scope: a client (`clientId`) OR the caller's personal area
   * (`personal=true`). Delegates to the SAME shared DatabankService the
   * Processing databank uses; access is enforced there. `types` is a
   * comma-separated list of buckets (image,pdf,video,audio,office,other);
   * `folderId` scopes to one folder ('null'/'root'/'' = the databank root).
   */
  @Get('search')
  @RequirePermissions(READ)
  search(@Query() dto: SearchDatabankDto, @CurrentUser() user: RequestUser) {
    return this.databank.searchDatabank(user, {
      clientId: dto.clientId,
      personal: dto.personal,
      q: dto.q,
      folderId: parseFolderId(dto.folderId),
      types: dto.types
        ? dto.types.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  // ---- My workspace (the caller's OWN personal folders, not tied to a client)
  // Owner-scoped (delegates to the shared personal store), reached with JR perms.

  @Get('me/tree')
  @RequirePermissions(READ)
  getMyTree(@CurrentUser() user: RequestUser) {
    return this.databank.getPersonalTree(user);
  }

  @Post('me/folders')
  @RequirePermissions(WRITE)
  createMyFolder(@Body() dto: CreateFolderDto, @CurrentUser() user: RequestUser) {
    return this.databank.createPersonalFolder(user, dto);
  }

  @Post('me/files')
  @RequirePermissions(WRITE)
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: tmpdir() }), limits: { fileSize: MAX_FILE_BYTES } }))
  uploadMyFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('folderId') folderId: string | undefined,
    @Body('source') source: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.uploadPersonalFile(user, file, folderId || null, source);
  }

  // ---- Resumable uploads (multi-GB; browser → R2 multipart, Phase 1) ------
  // docs/databank-phase1-resumable-uploads.md. The browser hashes each file,
  // INITs sessions, PUTs parts straight to R2 with presigned URLs (no bytes
  // through the backend) and COMPLETEs. Same write permission as any upload;
  // sessions are private to their creator; access is re-checked at complete.

  @Post('uploads/init')
  @RequirePermissions(WRITE)
  initUploads(@Body() dto: InitUploadsDto, @CurrentUser() user: RequestUser) {
    return this.uploads.init(dto, user);
  }

  @Post('uploads/complete')
  @RequirePermissions(WRITE)
  completeUploads(@Body() dto: CompleteUploadsDto, @CurrentUser() user: RequestUser) {
    return this.uploads.complete(dto, user);
  }

  /** The caller's unfinished uploads (drives the "resume" banner). */
  @Get('uploads')
  @RequirePermissions(WRITE)
  listUploads(@CurrentUser() user: RequestUser) {
    return this.uploads.listOpen(user);
  }

  @Post('uploads/:id/parts')
  @RequirePermissions(WRITE)
  signUploadParts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignPartsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.uploads.signParts(id, dto, user);
  }

  @Delete('uploads/:id')
  @RequirePermissions(WRITE)
  abortUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.uploads.abort(id, user);
  }

  // ---- Direct-to-storage upload (large files → R2, bypassing the backend) --
  // The browser presigns an upload, PUTs the bytes STRAIGHT to R2, then commits
  // the DB row — no bytes flow through Railway. Delegates to the SAME shared
  // service methods the Processing databank uses; scope (client vs the caller's
  // personal area) is in the body.

  @Post('uploads/presign')
  @RequirePermissions(WRITE)
  presignUpload(@Body() dto: PresignUploadDto, @CurrentUser() user: RequestUser) {
    return this.databank.presignDirectUpload(dto, user);
  }

  @Post('uploads/commit')
  @RequirePermissions(WRITE)
  commitUpload(@Body() dto: CommitUploadDto, @CurrentUser() user: RequestUser) {
    return this.databank.commitDirectUpload(dto, user);
  }

  // ---- Folders ------------------------------------------------------------

  @Post('clients/:clientId/folders')
  @RequirePermissions(WRITE)
  createFolder(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.createFolder(clientId, dto, user);
  }

  /** Get-or-create a dropped folder tree in one call (see the Processing
   *  controller). Scope in the body: a client, or the caller's personal area. */
  @Post('folders/ensure-paths')
  @RequirePermissions(WRITE)
  ensureFolderPaths(@Body() dto: EnsureFolderPathsDto, @CurrentUser() user: RequestUser) {
    return this.databank.ensureFolderPaths(dto, user);
  }

  @Patch('folders/:folderId')
  @RequirePermissions(WRITE)
  renameFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() dto: RenameFolderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.renameFolder(folderId, dto.name, user);
  }

  @Patch('folders/:folderId/move')
  @RequirePermissions(WRITE)
  moveFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() dto: MoveFolderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.moveFolder(folderId, dto.parentFolderId, user);
  }

  @Delete('folders/:folderId')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FOLDER_DELETED', entityType: 'DatabankFolder', category: 'MUTATION', severity: 'MEDIUM' })
  deleteFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.deleteFolder(folderId, user);
  }

  // ---- Files --------------------------------------------------------------

  /**
   * Upload into a client's databank. multipart/form-data, field "file".
   * Optional form fields: `folderId` (destination; omit = client root) and
   * `source` ("CLIPBOARD" for a pasted screenshot, else UPLOAD).
   */
  @Post('clients/:clientId/files')
  @RequirePermissions(WRITE)
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: tmpdir() }), limits: { fileSize: MAX_FILE_BYTES } }))
  uploadFile(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('folderId') folderId: string | undefined,
    @Body('source') source: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.uploadFile(clientId, file, folderId || null, source, user);
  }

  @Get('files/:fileId/signed-url')
  @RequirePermissions(READ)
  @AuditDocumentAccess('DatabankFile', 'fileId')
  getSignedUrl(@Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: RequestUser) {
    return this.databank.getSignedUrl(fileId, user);
  }

  /** Rename AND/OR set metadata (description, tags). A `fileName`-only body is a
   *  plain rename — the previous behaviour is unchanged. */
  @Patch('files/:fileId')
  @RequirePermissions(WRITE)
  updateFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: UpdateFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.updateFile(fileId, dto, user);
  }

  @Patch('files/:fileId/move')
  @RequirePermissions(WRITE)
  moveFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: MoveFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.moveFile(fileId, dto.folderId, user);
  }

  @Post('files/:fileId/copy')
  @RequirePermissions(WRITE)
  copyFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: CopyFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.copyFile(fileId, dto, user);
  }

  @Delete('files/:fileId')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FILE_DELETED', entityType: 'DatabankFile', category: 'MUTATION', severity: 'MEDIUM' })
  deleteFile(@Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: RequestUser) {
    return this.databank.deleteFile(fileId, user);
  }

  // ---- File versions (Databank P3-2) --------------------------------------
  // Delegates to the SAME shared service the Processing databank uses; access is
  // enforced there. list / signed-url are READ; the mutators are WRITE and honour
  // an optional If-Match on the file's version ETag (W/"<versionSeq>"); a version
  // purge is irreversible → audited HIGH.

  /** The version history (newest first) + the ETag for If-Match. */
  @Get('files/:fileId/versions')
  @RequirePermissions(READ)
  async listVersions(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.databank.listVersions(fileId, user);
    res.setHeader('ETag', out.etag);
    return out;
  }

  @Get('files/:fileId/versions/:versionId/signed-url')
  @RequirePermissions(READ)
  @AuditDocumentAccess('DatabankFile', 'fileId')
  getVersionSignedUrl(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.getVersionSignedUrl(fileId, versionId, user);
  }

  @Post('files/:fileId/versions/presign')
  @RequirePermissions(WRITE)
  presignVersion(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: PresignVersionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.presignNewVersion(fileId, dto, user);
  }

  @Post('files/:fileId/versions/commit')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FILE_VERSION_ADDED', entityType: 'DatabankFile', category: 'MUTATION', severity: 'MEDIUM' })
  commitVersion(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: CommitVersionDto,
    @CurrentUser() user: RequestUser,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.databank.commitNewVersion(fileId, dto, user, ifMatch);
  }

  @Post('files/:fileId/versions/:versionId/restore')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FILE_VERSION_RESTORED', entityType: 'DatabankFile', category: 'MUTATION', severity: 'MEDIUM' })
  restoreVersion(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: RequestUser,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.databank.restoreVersion(fileId, versionId, user, ifMatch);
  }

  @Patch('files/:fileId/versions/:versionId')
  @RequirePermissions(WRITE)
  renameVersion(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: RenameVersionDto,
    @CurrentUser() user: RequestUser,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.databank.renameVersion(fileId, versionId, dto.name, user, ifMatch);
  }

  @Delete('files/:fileId/versions/:versionId')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FILE_VERSION_PURGED', entityType: 'DatabankFile', category: 'MUTATION', severity: 'HIGH' })
  deleteVersion(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: RequestUser,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.databank.deleteVersion(fileId, versionId, user, ifMatch);
  }

  // ---- Trash (soft-delete recovery + permanent purge, Databank P3) ---------
  // Delegates to the SAME shared service the Processing databank uses; access is
  // enforced there. list is READ; restore / purge are WRITE (purge is audited HIGH).

  /** The TOP-LEVEL trashed items in one scope (clientId OR personal). */
  @Get('trash')
  @RequirePermissions(READ)
  listTrash(@Query() dto: TrashQueryDto, @CurrentUser() user: RequestUser) {
    return this.databank.listTrash(user, { clientId: dto.clientId, personal: dto.personal });
  }

  @Post('folders/:folderId/restore')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FOLDER_RESTORED', entityType: 'DatabankFolder', category: 'MUTATION', severity: 'MEDIUM' })
  restoreFolder(@Param('folderId', ParseUUIDPipe) folderId: string, @CurrentUser() user: RequestUser) {
    return this.databank.restoreFolder(folderId, user);
  }

  @Post('files/:fileId/restore')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FILE_RESTORED', entityType: 'DatabankFile', category: 'MUTATION', severity: 'MEDIUM' })
  restoreFile(@Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: RequestUser) {
    return this.databank.restoreFile(fileId, user);
  }

  @Delete('folders/:folderId/purge')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FOLDER_PURGED', entityType: 'DatabankFolder', category: 'MUTATION', severity: 'HIGH' })
  purgeFolder(@Param('folderId', ParseUUIDPipe) folderId: string, @CurrentUser() user: RequestUser) {
    return this.databank.purgeFolder(folderId, user);
  }

  @Delete('files/:fileId/purge')
  @RequirePermissions(WRITE)
  @Audit({ action: 'DATABANK_FILE_PURGED', entityType: 'DatabankFile', category: 'MUTATION', severity: 'HIGH' })
  purgeFile(@Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: RequestUser) {
    return this.databank.purgeFile(fileId, user);
  }
}
