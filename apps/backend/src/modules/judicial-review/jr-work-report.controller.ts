import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrWorkReportService } from './jr-work-report.service';
import {
  CreateWorkReportDto,
  CreateWorkReportNoteDto,
  EmailWorkReportDto,
  ListWorkReportsQueryDto,
} from './judicial-review.dto';

const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * JR associate work-report endpoints (§11.7, PR 10A). Every handler carries an
 * EXPLICIT @RequirePermissions (a missing decorator = an open route).
 *
 * The compiled body is a client-work-product surface, so the GET handlers carry
 * NO @Audit — plain reads are not auto-captured, so the compiled work never
 * reaches the org-wide AuditLog (the leak class forbidden for ActivityTimeline).
 * The write handlers ARE auto-captured (POST/DELETE), but with captureBody:false
 * so the request body (report notes / subject) is never stored either.
 */
@Controller('jr/reports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrWorkReportController {
  constructor(private readonly reports: JrWorkReportService) {}

  /** Compile a work report for a period (subject resolved server-side). */
  @Post()
  @RequirePermissions('jr.report.generate')
  @Audit({ entityType: 'JrWorkReport', category: 'MUTATION', severity: 'LOW', captureBody: false })
  create(@Body() dto: CreateWorkReportDto, @CurrentUser() user: RequestUser) {
    return this.reports.create(dto, user);
  }

  /** List reports visible to the caller (view_all sees all; else own only). */
  @Get()
  @RequirePermissions('jr.report.generate')
  list(@Query() query: ListWorkReportsQueryDto, @CurrentUser() user: RequestUser) {
    return this.reports.list(query, user);
  }

  /** The pickable-subject list (view_all → all JR staff; else just the caller). */
  @Get('subjects')
  @RequirePermissions('jr.report.generate')
  subjects(@CurrentUser() user: RequestUser) {
    return this.reports.subjects(user);
  }

  /** Load one report + its LIVE compiled body + enrichments (own-or-view_all). */
  @Get(':id')
  @RequirePermissions('jr.report.generate')
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.reports.getById(id, user);
  }

  /** Add a report-level narrative note (DRAFT-only, author-attributed). */
  @Post(':id/notes')
  @RequirePermissions('jr.report.generate')
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', category: 'MUTATION', severity: 'LOW', captureBody: false })
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWorkReportNoteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.addNote(id, dto, user);
  }

  /** Soft-delete a report-level note (DRAFT-only). */
  @Delete(':id/notes/:noteId')
  @RequirePermissions('jr.report.generate')
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', action: 'RECORD_DELETED', category: 'MUTATION', severity: 'LOW', captureBody: false })
  deleteNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.deleteNote(id, noteId, user);
  }

  // ---------------------------------------------------------------------------
  // Media enrichments (§11.7, PR 10B) — image + voice, DRAFT-only
  // ---------------------------------------------------------------------------

  /** Attach an image (screenshot / photo) to a DRAFT report (DRAFT-only). */
  @Post(':id/attachments/image')
  @RequirePermissions('jr.report.generate')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_FILE_BYTES } }))
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', category: 'MUTATION', severity: 'LOW', captureBody: false })
  addImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.addImage(id, file, user);
  }

  /** Attach a voice note (transcribed to Roman Urdu inline) to a DRAFT report. */
  @Post(':id/attachments/voice')
  @RequirePermissions('jr.report.generate')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_FILE_BYTES } }))
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', category: 'MUTATION', severity: 'LOW', captureBody: false })
  addVoice(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.addVoice(id, file, user);
  }

  /** Mint a short-lived signed URL for an attachment (own-or-view_all; NO @Audit). */
  @Get(':id/attachments/:attachmentId/signed-url')
  @RequirePermissions('jr.report.generate')
  attachmentSignedUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.attachmentSignedUrl(id, attachmentId, user);
  }

  /** Soft-delete an attachment (DRAFT-only; reportId match is the IDOR guard). */
  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions('jr.report.generate')
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', action: 'RECORD_DELETED', category: 'MUTATION', severity: 'LOW', captureBody: false })
  deleteAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.deleteAttachment(id, attachmentId, user);
  }

  // ---------------------------------------------------------------------------
  // Render / finalize / email (§11.7, PR 10C)
  // ---------------------------------------------------------------------------

  /**
   * Freeze a DRAFT into an immutable PDF snapshot (own-or-view_all + DRAFT-only).
   * captureBody:false so the compiled client work never reaches the org AuditLog.
   */
  @Post(':id/finalize')
  @RequirePermissions('jr.report.generate')
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', category: 'MUTATION', severity: 'LOW', captureBody: false })
  finalize(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.reports.finalize(id, user);
  }

  /**
   * Stream the report PDF inline (own-or-view_all). A FINALIZED report streams
   * the frozen snapshot; a DRAFT renders live. NO @Audit — a plain read, so the
   * compiled work-product is never auto-captured (mirrors the GET handlers).
   */
  @Get(':id/pdf')
  @RequirePermissions('jr.report.generate')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.reports.renderPdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  /** Email the report PDF outbound (Head only — jr.report.share). */
  @Post(':id/email')
  @RequirePermissions('jr.report.share')
  @Audit({ idParam: 'id', entityType: 'JrWorkReport', category: 'MUTATION', severity: 'MEDIUM', captureBody: false })
  email(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmailWorkReportDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.emailReport(id, dto, user);
  }
}
