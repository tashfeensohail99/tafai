import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  ListWorkReportsQueryDto,
} from './judicial-review.dto';

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
}
