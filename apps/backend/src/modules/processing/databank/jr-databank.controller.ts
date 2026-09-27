import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import {
  CommitUploadDto,
  CopyFileDto,
  CreateFolderDto,
  MoveFileDto,
  MoveFolderDto,
  PresignUploadDto,
  RenameFileDto,
  RenameFolderDto,
} from './databank.dto';

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
  constructor(private readonly databank: DatabankService) {}

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

  @Patch('files/:fileId')
  @RequirePermissions(WRITE)
  renameFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: RenameFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.databank.renameFile(fileId, dto.fileName, user);
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
}
