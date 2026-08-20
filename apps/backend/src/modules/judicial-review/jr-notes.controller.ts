import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrNotesService } from './jr-notes.service';
import { CreateJrNoteDto, UpdateJrNoteDto } from './judicial-review.dto';

const MAX_NOTE_FILE_BYTES = 25 * 1024 * 1024;

/**
 * JR case-workspace notes — text plus a single voice or image attachment. Every
 * handler is permission-gated AND re-checks matter-level access in the service
 * (never relies on list scoping alone — #253/#255). Each mutation carries an
 * explicit @Audit decorator because the global interceptor's ID_PARAM_PRIORITY
 * has no `matterId`/`noteId` — without it the audit row's entityId is null.
 */
@Controller('jr')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrNotesController {
  constructor(private readonly notes: JrNotesService) {}

  @Get('matters/:matterId/notes')
  @RequirePermissions('jr.portal.view')
  list(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notes.listForMatter(matterId, user);
  }

  @Post('matters/:matterId/notes')
  @RequirePermissions('jr.note.create')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', action: 'RECORD_CREATED', category: 'MUTATION', severity: 'LOW' })
  create(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: CreateJrNoteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notes.createText(matterId, dto, user);
  }

  @Post('matters/:matterId/notes/voice')
  @RequirePermissions('jr.note.create')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', action: 'RECORD_CREATED', category: 'MUTATION', severity: 'LOW' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_NOTE_FILE_BYTES } }))
  createVoice(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('content') content: string | undefined,
    @Body('durationMs') durationMs: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    // durationMs arrives as a multipart string; a non-numeric value is ignored.
    const parsed = durationMs !== undefined ? Number(durationMs) : NaN;
    return this.notes.createVoice(matterId, file, user, {
      content,
      durationMs: Number.isNaN(parsed) ? undefined : parsed,
    });
  }

  @Post('matters/:matterId/notes/image')
  @RequirePermissions('jr.note.create')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', action: 'RECORD_CREATED', category: 'MUTATION', severity: 'LOW' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_NOTE_FILE_BYTES } }))
  createImage(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('content') content: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notes.createImage(matterId, file, user, { content });
  }

  @Patch('notes/:noteId')
  @RequirePermissions('jr.note.create')
  @Audit({ idParam: 'noteId', entityType: 'JrNote', category: 'MUTATION', severity: 'LOW' })
  update(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateJrNoteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notes.update(noteId, dto, user);
  }

  @Delete('notes/:noteId')
  @RequirePermissions('jr.note.create')
  @Audit({ idParam: 'noteId', entityType: 'JrNote', action: 'RECORD_DELETED', category: 'MUTATION', severity: 'LOW' })
  remove(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notes.softDelete(noteId, user);
  }
}
