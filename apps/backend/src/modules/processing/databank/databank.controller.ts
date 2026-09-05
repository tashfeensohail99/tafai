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
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { AuditDocumentAccess } from '../../../common/decorators/audit-document-access.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { DatabankService } from './databank.service';
import {
  CopyFileDto,
  CreateFolderDto,
  MoveFileDto,
  MoveFolderDto,
  RenameFileDto,
  RenameFolderDto,
} from './databank.dto';

/**
 * The per-client databank API — a Drive-like document repository for the
 * Processing team. Read routes admit anyone who can see processing cases
 * (view_assigned OR view_all); the SERVICE narrows what each user actually
 * sees, per client. Write routes reuse processing.document.upload, so no new
 * permission or seed change was needed. Manager-vs-officer scoping lives
 * entirely in DatabankService.assertClientAccess.
 *
 * 50 MB Multer cap: the databank replaces Google Drive for scans and PDFs;
 * larger media isn't supported because uploads buffer wholly in memory.
 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const READ = ['processing.case.view_assigned', 'processing.case.view_all'] as const;
const WRITE = 'processing.document.upload';

@Controller('processing/databank')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DatabankController {
  constructor(private readonly databank: DatabankService) {}

  // ---- Browse -------------------------------------------------------------

  /** Cross-client landing: clients the caller may see + their file counts. */
  @Get('clients')
  @RequireAnyPermissions(...READ)
  listClients(@CurrentUser() user: RequestUser, @Query('q') q?: string) {
    return this.databank.listClients(user, q);
  }

  /** Associate-organised landing: clients grouped by the officer they belong to
   *  (manager sees every associate + her own; officer sees only her own). */
  @Get('clients/by-associate')
  @RequireAnyPermissions(...READ)
  listByAssociate(@CurrentUser() user: RequestUser, @Query('q') q?: string) {
    return this.databank.clientsByAssociate(user, q);
  }

  /** The full folder tree + files for one client. */
  @Get('clients/:clientId/tree')
  @RequireAnyPermissions(...READ)
  getTree(@Param('clientId', ParseUUIDPipe) clientId: string, @CurrentUser() user: RequestUser) {
    return this.databank.getTree(clientId, user);
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
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } }))
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
  @RequireAnyPermissions(...READ)
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
