import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ProcessingService } from './processing.service';
import {
  AcknowledgeIntakeDto,
  AddDocumentItemDto,
  AssignCaseDto,
  ChangeCaseStageDto,
  CreateAuthoritySubmissionDto,
  CreateCaseMilestoneDto,
  CreateCorrectionRequestDto,
  CreateDocumentTemplateDto,
  CreateProcessingCaseDto,
  CreateProcessingNoteDto,
  CreateProcessingTaskDto,
  EscalateCorrectionRequestDto,
  ListCorrectionRequestsQueryDto,
  ListIntakeQueueQueryDto,
  ListProcessingCasesQueryDto,
  MarkCaseForRefundDto,
  ReportDateRangeQueryDto,
  ReportExportQueryDto,
  RequestDocumentDto,
  ResolveCorrectionRequestDto,
  ReviewDocumentDto,
  FileInboundDocumentDto,
  SendCommunicationDto,
  UpdateAuthoritySubmissionDto,
  UpdateCasePriorityDto,
  UpdateDocumentTemplateDto,
  UpdateProcessingTaskDto,
  WaiveDocumentItemDto,
} from './processing.dto';

@Controller('processing')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProcessingController {
  constructor(private readonly processingService: ProcessingService) {}

  // -------------------------------------------------------------------------
  // INTAKE
  // -------------------------------------------------------------------------

  @Post('intake')
  @RequirePermissions('finance.view_all') // Finance officer triggers this
  createFromHandover(
    @Body() dto: CreateProcessingCaseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createFromHandover(dto, user);
  }

  @Get('intake')
  @RequirePermissions('processing.intake.view')
  listIntakeQueue(@Query() query: ListIntakeQueueQueryDto) {
    return this.processingService.listIntakeQueue(query);
  }

  @Post('intake/:caseId/acknowledge')
  @RequirePermissions('processing.intake.acknowledge')
  acknowledgeIntake(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: AcknowledgeIntakeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.acknowledgeIntake(caseId, dto, user);
  }

  /**
   * Officer roster for the assign-on-acknowledge picker + reassignment UI.
   * Returns active users in any processing-side role (associate / manager /
   * documentation / admin). Sales / finance / support are excluded.
   */
  @Get('officers')
  @RequireAnyPermissions('processing.case.assign', 'processing.case.view_all')
  listProcessingOfficers() {
    return this.processingService.listProcessingOfficers();
  }

  // -------------------------------------------------------------------------
  // CASES
  // -------------------------------------------------------------------------

  @Get('dashboard')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getDashboard(@CurrentUser() user: RequestUser) {
    return this.processingService.getDashboardMetrics(user);
  }

  /**
   * Admin processing overview — totals, stage breakdown, officer workload,
   * recent intake, and SLA-breached cases. Surfaced inside the admin shell
   * so admins don't leave /admin to see the full processing picture.
   * Permission: processing.case.view_all (manager / admin only).
   */
  @Get('admin-overview')
  @RequirePermissions('processing.case.view_all')
  getAdminOverview() {
    return this.processingService.getAdminOverview();
  }

  @Get('cases')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  listCases(
    @Query() query: ListProcessingCasesQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.listCases(query, user);
  }

  @Get('cases/:caseId')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseById(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getCaseById(caseId, user);
  }

  @Patch('cases/:caseId/stage')
  @RequirePermissions('processing.case.update_stage')
  changeCaseStage(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: ChangeCaseStageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.changeCaseStage(caseId, dto, user);
  }

  @Patch('cases/:caseId/assign')
  @RequirePermissions('processing.case.assign')
  assignCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: AssignCaseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.assignCase(caseId, dto, user);
  }

  @Patch('cases/:caseId/priority')
  @RequirePermissions('processing.case.assign')
  updateCasePriority(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: UpdateCasePriorityDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.updateCasePriority(caseId, dto, user);
  }

  // -------------------------------------------------------------------------
  // CROSS-CASE TASKS / DOCUMENTS  — side-page queries
  // -------------------------------------------------------------------------

  /**
   * Aggregated open-task queue across the user's cases. Non-terminal tasks
   * (OPEN / IN_PROGRESS / BLOCKED) on non-terminal cases only.
   */
  @Get('tasks')
  @RequireAnyPermissions('processing.task.create', 'processing.case.view_all')
  listAggregatedTasks(@CurrentUser() user: RequestUser) {
    return this.processingService.listAggregatedTasks(user);
  }

  /**
   * Aggregated documents needing officer action across cases: SUBMITTED /
   * UNDER_REVIEW / REJECTED / EXPIRING_SOON / EXPIRED.
   */
  @Get('documents')
  @RequireAnyPermissions('processing.document.review', 'processing.case.view_all')
  listAggregatedDocuments(@CurrentUser() user: RequestUser) {
    return this.processingService.listAggregatedDocuments(user);
  }

  // -------------------------------------------------------------------------
  // REFUND / ESCALATION LANE
  // -------------------------------------------------------------------------

  /**
   * Dedicated queue of REJECTED cases needing refund or escalation handling.
   * Per-row `refundInitiatedAt` lets the UI badge cases that already had a
   * refund recorded so officers don't double-action them.
   */
  @Get('refunds')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  listRefundLane(@CurrentUser() user: RequestUser) {
    return this.processingService.listRefundLane(user);
  }

  @Post('cases/:caseId/refund')
  @RequirePermissions('processing.case.update_stage')
  markCaseForRefund(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: MarkCaseForRefundDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.markCaseForRefund(caseId, dto, user);
  }

  // -------------------------------------------------------------------------
  // DOCUMENTS
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/documents')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getDocumentChecklist(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getDocumentChecklist(caseId, user);
  }

  @Post('cases/:caseId/documents')
  @RequirePermissions('processing.document.review')
  addDocumentItem(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: AddDocumentItemDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.addDocumentItem(caseId, dto, user);
  }

  @Patch('cases/:caseId/documents/:itemId/waive')
  @RequirePermissions('processing.document.waive')
  waiveDocumentItem(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: WaiveDocumentItemDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.waiveDocumentItem(caseId, itemId, dto, user);
  }

  @Patch('cases/:caseId/documents/:itemId/request')
  @RequirePermissions('processing.document.request')
  requestDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: RequestDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.requestDocument(caseId, itemId, dto, user);
  }

  @Get('cases/:caseId/documents/:itemId/versions')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getDocumentVersions(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getDocumentVersions(caseId, itemId, user);
  }

  @Get('cases/:caseId/documents/:itemId/signed-url')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getSignedDocumentUrl(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.processingService.getSignedDocumentUrl(
      caseId,
      itemId,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('cases/:caseId/documents/:itemId/upload')
  @RequirePermissions('processing.document.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB hard cap — item limit enforced in service
    }),
  )
  uploadOfficerDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.processingService.uploadOfficerDocument(
      caseId,
      itemId,
      file,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('cases/:caseId/documents/:itemId/review')
  @RequirePermissions('processing.document.review')
  reviewDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ReviewDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.reviewDocument(caseId, itemId, dto, user);
  }

  // -------------------------------------------------------------------------
  // INBOUND DOCUMENT INTAKE (Phase E) — WhatsApp/email/portal docs awaiting triage
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/inbound-documents')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  listInboundDocuments(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.listInboundDocuments(caseId, user);
  }

  @Post('cases/:caseId/inbound-documents/:inboundId/file')
  @RequirePermissions('processing.document.upload')
  fileInboundDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('inboundId', ParseUUIDPipe) inboundId: string,
    @Body() dto: FileInboundDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.fileInboundDocument(caseId, inboundId, dto.itemId, user);
  }

  @Post('cases/:caseId/inbound-documents/:inboundId/discard')
  @RequirePermissions('processing.document.review')
  discardInboundDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('inboundId', ParseUUIDPipe) inboundId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.discardInboundDocument(caseId, inboundId, user);
  }

  @Post('cases/:caseId/request-missing-documents')
  @RequirePermissions('processing.document.request')
  requestMissingDocuments(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.requestMissingDocuments(caseId, user);
  }

  // -------------------------------------------------------------------------
  // NOTES
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/notes')
  @RequireAnyPermissions('processing.note.create', 'processing.note.view_all')
  getNotes(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getNotes(caseId, user);
  }

  @Post('cases/:caseId/notes')
  @RequirePermissions('processing.note.create')
  createNote(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateProcessingNoteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createNote(caseId, dto, user);
  }

  @Patch('cases/:caseId/notes/:noteId/pin')
  @RequirePermissions('processing.note.create')
  toggleNotePin(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.toggleNotePin(caseId, noteId, user);
  }

  // -------------------------------------------------------------------------
  // CASE MILESTONES
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/milestones')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseMilestones(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.listCaseMilestones(caseId, user);
  }

  /**
   * Add an ad-hoc milestone to a case. Manager-gated — associates work
   * the seeded list; only managers extend it.
   */
  @Post('cases/:caseId/milestones')
  @RequirePermissions('processing.case.assign')
  createCaseMilestone(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateCaseMilestoneDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createCaseMilestone(caseId, dto, user);
  }

  @Patch('cases/:caseId/milestones/:milestoneId/complete')
  @RequirePermissions('processing.case.update_stage')
  completeMilestone(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.completeMilestone(caseId, milestoneId, user);
  }

  @Patch('cases/:caseId/milestones/:milestoneId/uncomplete')
  @RequirePermissions('processing.case.update_stage')
  uncompleteMilestone(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.uncompleteMilestone(caseId, milestoneId, user);
  }

  // -------------------------------------------------------------------------
  // TASKS
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/tasks')
  @RequireAnyPermissions('processing.task.create', 'processing.case.view_all')
  getTasks(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getTasks(caseId, user);
  }

  @Post('cases/:caseId/tasks')
  @RequirePermissions('processing.task.create')
  createTask(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateProcessingTaskDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createTask(caseId, dto, user);
  }

  @Patch('cases/:caseId/tasks/:taskId')
  @RequirePermissions('processing.task.create')
  updateTask(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateProcessingTaskDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.updateTask(caseId, taskId, dto, user);
  }

  // -------------------------------------------------------------------------
  // COMMUNICATIONS
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/communications')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCommunications(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getCommunications(caseId, user);
  }

  @Post('cases/:caseId/communications')
  @RequirePermissions('processing.communication.send')
  sendCommunication(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: SendCommunicationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.sendCommunication(caseId, dto, user);
  }

  // -------------------------------------------------------------------------
  // AUTHORITY SUBMISSIONS
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/submissions')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getSubmissions(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getSubmissions(caseId, user);
  }

  @Post('cases/:caseId/submissions')
  @RequirePermissions('processing.case.update_stage')
  createSubmission(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateAuthoritySubmissionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createSubmission(caseId, dto, user);
  }

  @Patch('cases/:caseId/submissions/:submissionId')
  @RequirePermissions('processing.case.update_stage')
  updateSubmission(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: UpdateAuthoritySubmissionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.updateSubmission(caseId, submissionId, dto, user);
  }

  // -------------------------------------------------------------------------
  // AUDIT
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/audit')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseAudit(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getCaseAudit(caseId, user);
  }

  // -------------------------------------------------------------------------
  // CORRECTION REQUESTS
  // -------------------------------------------------------------------------

  @Post('cases/:caseId/corrections')
  @RequirePermissions('processing.document.request')
  createCorrectionRequest(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateCorrectionRequestDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.processingService.createCorrectionRequest(
      caseId,
      dto,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('cases/:caseId/corrections')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  listCorrectionRequests(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Query() query: ListCorrectionRequestsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.listCorrectionRequests(caseId, query, user);
  }

  @Patch('cases/:caseId/corrections/:correctionId/resolve')
  @RequirePermissions('processing.document.request')
  resolveCorrectionRequest(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('correctionId', ParseUUIDPipe) correctionId: string,
    @Body() dto: ResolveCorrectionRequestDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.processingService.resolveCorrectionRequest(
      caseId,
      correctionId,
      dto,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Patch('cases/:caseId/corrections/:correctionId/escalate')
  @RequirePermissions('processing.document.request')
  escalateCorrectionRequest(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('correctionId', ParseUUIDPipe) correctionId: string,
    @Body() dto: EscalateCorrectionRequestDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.processingService.escalateCorrectionRequest(
      caseId,
      correctionId,
      dto,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  // -------------------------------------------------------------------------
  // CHECKLIST TEMPLATES
  // -------------------------------------------------------------------------

  @Get('checklist-templates')
  @RequireAnyPermissions('processing.checklist.manage', 'processing.intake.view')
  listTemplates(
    @Query('service') service?: string,
    @Query('targetCountry') targetCountry?: string,
  ) {
    return this.processingService.listTemplates(service, targetCountry);
  }

  @Post('checklist-templates')
  @RequirePermissions('processing.checklist.manage')
  createTemplate(
    @Body() dto: CreateDocumentTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createTemplate(dto, user);
  }

  @Patch('checklist-templates/:id')
  @RequirePermissions('processing.checklist.manage')
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentTemplateDto,
  ) {
    return this.processingService.updateTemplate(id, dto);
  }

  @Delete('checklist-templates/:id')
  @RequirePermissions('processing.checklist.manage')
  deactivateTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.processingService.deactivateTemplate(id);
  }

  // -------------------------------------------------------------------------
  // REPORTS
  // -------------------------------------------------------------------------

  @Get('reports/workload')
  @RequirePermissions('processing.report.view')
  getWorkloadReport(@Query() query: ReportDateRangeQueryDto) {
    return this.processingService.getWorkloadReport(query);
  }

  @Get('reports/throughput')
  @RequirePermissions('processing.report.view')
  getThroughputReport(@Query() query: ReportDateRangeQueryDto) {
    return this.processingService.getThroughputReport(query);
  }

  @Get('reports/doc-quality')
  @RequirePermissions('processing.report.view')
  getDocQualityReport(@Query() query: ReportDateRangeQueryDto) {
    return this.processingService.getDocQualityReport(query);
  }

  @Get('reports/sla')
  @RequirePermissions('processing.report.view')
  getSlaReport(@Query() query: ReportDateRangeQueryDto) {
    return this.processingService.getSlaReport(query);
  }

  @Get('reports/expiry-risk')
  @RequirePermissions('processing.report.view')
  getExpiryRiskReport(@Query() query: ReportDateRangeQueryDto) {
    return this.processingService.getExpiryRiskReport(query);
  }

  @Get('reports/export')
  @RequirePermissions('processing.report.export')
  async exportReport(
    @Query() query: ReportExportQueryDto,
    @Res() res: Response,
  ) {
    const { csv, filename } = await this.processingService.exportReport(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  }

  // -------------------------------------------------------------------------
  // DOCUMENT RE-OPEN
  // -------------------------------------------------------------------------

  @Patch('cases/:caseId/documents/:itemId/reopen')
  @RequirePermissions('processing.document.review')
  reopenDocumentItem(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.reopenDocumentItem(caseId, itemId, user);
  }
}
