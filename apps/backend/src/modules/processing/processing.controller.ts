import {
  BadRequestException,
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
import { AuditDocumentAccess } from '../../common/decorators/audit-document-access.decorator';
import { Audit, NoAudit } from '../../common/decorators/audit.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ProcessingService } from './processing.service';
import { SubmissionPackageService } from './submission-package.service';
import { parseSpreadsheet } from '../lead-imports/parsers/spreadsheet-parser';
import {
  AcknowledgeIntakeDto,
  AddDocumentItemDto,
  AssignCaseDto,
  ChangeCaseStageDto,
  CreateAuthoritySubmissionDto,
  CreateCaseMilestoneDto,
  CreateCorrectionRequestDto,
  CreateDocumentTemplateDto,
  CreateEmailTemplateDto,
  CreateManualClientCaseDto,
  CreateProcessingCaseDto,
  CreateProcessingNoteDto,
  UpdateProcessingNoteDto,
  CreateProcessingTaskDto,
  EscalateCorrectionRequestDto,
  ListCorrectionRequestsQueryDto,
  ListIntakeQueueQueryDto,
  ListProcessingCasesQueryDto,
  MarkCaseForRefundDto,
  MarkCaseTabSeenDto,
  ReportDateRangeQueryDto,
  ReportExportQueryDto,
  RequestDocumentDto,
  ResolveCorrectionRequestDto,
  ReviewDocumentDto,
  FileInboundDocumentDto,
  SendCaseWhatsAppDto,
  SendCommunicationDto,
  UpdateEmailSignatureDto,
  UpdateAuthoritySubmissionDto,
  UpdateCasePriorityDto,
  UpdateCaseSubStageDto,
  UpdateDocumentTemplateDto,
  UpdateProcessingTaskDto,
  UpdateAttestationDto,
  WaiveDocumentItemDto,
  RenameAdditionalDocumentDto,
} from './processing.dto';

@Controller('processing')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProcessingController {
  constructor(
    private readonly processingService: ProcessingService,
    private readonly submissionPackageService: SubmissionPackageService,
  ) {}

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

  /**
   * Manual client on-ramp — a Processing Manager creates a client + case
   * directly (no Finance handover). Gated by the manager-only intake
   * acknowledge permission (the processing_manager role already holds it).
   */
  @Post('clients')
  @RequirePermissions('processing.intake.acknowledge')
  createManualClientCase(
    @Body() dto: CreateManualClientCaseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.createManualClientCase(dto, user);
  }

  /**
   * Bulk client import — DRY RUN. Parses the uploaded xlsx/csv and resolves
   * every row (officer / sales rep / program / dupe status) WITHOUT writing.
   * Manager-only (same gate as manual create).
   */
  @Post('client-imports/preview')
  @RequirePermissions('processing.intake.acknowledge')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    }),
  )
  previewClientImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('A CSV or Excel file is required.');
    const parsed = parseSpreadsheet(file.buffer, file.mimetype, file.originalname);
    return this.processingService.bulkImportClients(parsed, user, true);
  }

  /**
   * Bulk client import — COMMIT. Creates each client + INTAKE case and assigns
   * the named processing officer. Idempotent (skips already-imported Case IDs).
   */
  @Audit({ action: 'CLIENTS_IMPORTED', entityType: 'ProcessingImport', category: 'MUTATION', severity: 'HIGH' })
  @Post('client-imports')
  @RequirePermissions('processing.intake.acknowledge')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  commitClientImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('A CSV or Excel file is required.');
    const parsed = parseSpreadsheet(file.buffer, file.mimetype, file.originalname);
    return this.processingService.bulkImportClients(parsed, user, false);
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

  // Same processing-team roster as /officers, but reachable by anyone who can
  // write a note — powers the @mention picker on the case Notes tab (assign /
  // view_all are manager-only, so associates couldn't use /officers).
  @Get('note-mention-candidates')
  @RequireAnyPermissions('processing.note.create', 'processing.note.view_all')
  listNoteMentionCandidates() {
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

  // Finance summary for the case's client (agreed / paid / balance + ledger
  // lists). Powers the workspace Finance tab; aggregates by lead + client so it
  // covers manual clients too.
  @Get('cases/:caseId/finance')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseFinance(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.processingService.getCaseFinance(caseId);
  }

  // P4d — submission readiness: { ready, blockers }. Surfaced in the workspace
  // so the associate sees outstanding blockers before attempting to submit.
  @Get('cases/:caseId/submission-readiness')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getSubmissionReadiness(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getSubmissionReadiness(caseId, user);
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

  // Set/clear the lightweight sub-stage tracking label (feedback F3). Officer-
  // editable (same gate as stage changes); assertCaseAccess scopes an associate
  // to their own case.
  @Patch('cases/:caseId/substage')
  @RequirePermissions('processing.case.update_stage')
  updateCaseSubStage(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: UpdateCaseSubStageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.updateCaseSubStage(caseId, dto, user);
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

  @Patch('cases/:caseId/documents/:itemId/attestation')
  @RequirePermissions('processing.document.review')
  updateDocumentAttestation(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateAttestationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.updateDocumentAttestation(caseId, itemId, dto, user);
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
  @AuditDocumentAccess('ProcessingCaseDocument', 'itemId')
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

  /**
   * POST /processing/cases/:caseId/additional-documents
   * Team uploads an EXTRA document not tied to a checklist slot
   * ("Additional Documents"). Optional `note` text field. Separate path so it
   * never collides with the `:itemId/upload` route.
   */
  @Post('cases/:caseId/additional-documents')
  @RequirePermissions('processing.document.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  uploadAdditionalDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('note') note: string | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new Error('No file provided. Use multipart/form-data with field name "file".');
    }
    return this.processingService.uploadAdditionalDocument(
      caseId,
      file,
      note,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  /**
   * PATCH /processing/cases/:caseId/documents/:itemId/name
   * Rename an additional document — correct a wrong AI label or clarify it.
   * Only additional (ad-hoc) items can be renamed (enforced in the service).
   */
  @Patch('cases/:caseId/documents/:itemId/name')
  @RequirePermissions('processing.document.upload')
  renameAdditionalDocument(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: RenameAdditionalDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.renameAdditionalDocument(caseId, itemId, dto.name, user);
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

  @Get('cases/:caseId/identity-reconciliation')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getIdentityReconciliation(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getIdentityReconciliation(caseId, user);
  }

  @Get('cases/:caseId/inbound-documents/:inboundId/signed-url')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  @AuditDocumentAccess('InboundDocument', 'inboundId')
  getInboundDocumentSignedUrl(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('inboundId', ParseUUIDPipe) inboundId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getInboundDocumentSignedUrl(caseId, inboundId, user);
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

  @Audit({ entityType: 'ProcessingCase', category: 'MUTATION', severity: 'HIGH', idParam: 'caseId' })
  @Post('cases/:caseId/request-missing-documents')
  @RequirePermissions('processing.document.request')
  requestMissingDocuments(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.requestMissingDocuments(caseId, user);
  }

  // -------------------------------------------------------------------------
  // CASE WHATSAPP CHAT (Phase E) — live two-way thread, scoped by case access
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/whatsapp')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseWhatsApp(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
    @Query('before') before?: string,
  ) {
    return this.processingService.getCaseWhatsApp(caseId, user, before);
  }

  @Audit({ entityType: 'ProcessingCase', category: 'MUTATION', severity: 'HIGH', idParam: 'caseId', action: 'WHATSAPP_MESSAGE_SENT' })
  @Post('cases/:caseId/whatsapp')
  @RequirePermissions('processing.communication.send')
  sendCaseWhatsApp(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: SendCaseWhatsAppDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.sendCaseWhatsApp(caseId, dto.body, user);
  }

  // -------------------------------------------------------------------------
  // TAB ACTIVITY — per-user "new items" count badges on the case workspace
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/tab-activity')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseTabActivity(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getCaseTabActivity(caseId, user);
  }

  @NoAudit()
  @Post('cases/:caseId/tab-seen')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  markCaseTabSeen(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: MarkCaseTabSeenDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.markCaseTabSeen(caseId, dto.tab, user);
  }

  // -------------------------------------------------------------------------
  // CROSS-DEPARTMENT HISTORY — Sales/Finance notes + call history/transcripts
  // -------------------------------------------------------------------------

  @Get('cases/:caseId/background')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getCaseBackground(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getCaseBackground(caseId, user);
  }

  @Get('cases/:caseId/calls/:callId/recording')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  @AuditDocumentAccess('CallRecording', 'callId')
  getCaseCallRecording(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('callId', ParseUUIDPipe) callId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.getCaseCallRecordingUrl(caseId, callId, user);
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

  // Edit / soft-delete a note. The service enforces author-or-manager; the
  // route just needs a note-capable role.
  @Patch('cases/:caseId/notes/:noteId')
  @RequireAnyPermissions('processing.note.create', 'processing.note.view_all')
  updateNote(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateProcessingNoteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.updateNote(caseId, noteId, dto, user);
  }

  @Delete('cases/:caseId/notes/:noteId')
  @RequireAnyPermissions('processing.note.create', 'processing.note.view_all')
  deleteNote(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.deleteNote(caseId, noteId, user);
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

  // Sent-email history for a case (feedback #11) — every EMAIL communication.
  @Get('cases/:caseId/emails')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  listCaseEmails(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.listCaseEmails(caseId, user);
  }

  // Per-user email signature for the composer (feedback #9).
  @Get('me/email-signature')
  @RequirePermissions('processing.communication.send')
  getMyEmailSignature(@CurrentUser() user: RequestUser) {
    return this.processingService.getMyEmailSignature(user);
  }

  @Patch('me/email-signature')
  @RequirePermissions('processing.communication.send')
  setMyEmailSignature(
    @Body() dto: UpdateEmailSignatureDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.setMyEmailSignature(user, dto);
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
  // CLIENT-EMAIL TEMPLATES (manager-editable nudge wording, per category)
  // -------------------------------------------------------------------------

  @Get('email-templates')
  @RequirePermissions('processing.checklist.manage')
  listEmailTemplates(
    @Query('service') service?: string,
    @Query('reminderType') reminderType?: string,
  ) {
    return this.processingService.listEmailTemplates(service, reminderType);
  }

  @Post('email-templates')
  @RequirePermissions('processing.checklist.manage')
  saveEmailTemplate(
    @Body() dto: CreateEmailTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.processingService.saveEmailTemplate(dto, user);
  }

  @Delete('email-templates/:id')
  @RequirePermissions('processing.checklist.manage')
  deleteEmailTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.processingService.deleteEmailTemplate(id);
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

  @Audit({ entityType: 'ProcessingReport', category: 'EXPORT', severity: 'HIGH', action: 'DATA_EXPORTED' })
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

  // -------------------------------------------------------------------------
  // P4e — SUBMISSION PACKAGE
  // -------------------------------------------------------------------------

  /** Assemble (or re-assemble) the merged PDF submission package for a case. */
  @Post('cases/:caseId/submission-package/assemble')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  assembleSubmissionPackage(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.submissionPackageService.assemblePackage(caseId, user);
  }

  /** Return info (signed URL) for the most-recently assembled package, if any. */
  @Get('cases/:caseId/submission-package')
  @RequireAnyPermissions('processing.case.view_assigned', 'processing.case.view_all')
  getSubmissionPackage(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.submissionPackageService.getPackageInfo(caseId, user);
  }
}
