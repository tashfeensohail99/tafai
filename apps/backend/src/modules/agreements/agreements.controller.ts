import {
  BadRequestException,
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { AuditDocumentAccess } from '../../common/decorators/audit-document-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementsService } from './agreements.service';
import {
  AdminSignedListQueryDto,
  CreateAgreementDto,
  CreateAgreementTemplateDto,
  CreateChangeRequestDto,
  ListAgreementsQueryDto,
  ListChangeRequestsQueryDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  RejectChangeRequestDto,
  RequestChangesDto,
  UpdateAgreementDto,
  UpdateAgreementTemplateDto,
} from './agreements.dto';

/** Permissions that grant a cross-agent VIEW of agreements (read scope). */
const VIEW_ALL_PERMS = ['finance.view_all', 'leads.view_all', 'settings.manage'];

/** Permissions that grant acting on ANY agreement's correction requests
 *  (write scope). Deliberately excludes the read-only `leads.view_all` so a
 *  sales-manager view permission can't create/cancel requests on others'
 *  agreements — only admin/finance bypass the ownership check. */
const MANAGE_ALL_PERMS = [
  'settings.manage',
  'finance.view_all',
  'finance.create_invoice',
  'finance.verify_payment',
];

/**
 * Agreement authoring. Template management (admin/finance) + Sales-side
 * drafting with structured payment plans. The Finance review/approve
 * workflow lands in the next slice.
 */
@Controller('agreements')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AgreementsController {
  constructor(
    private readonly templates: AgreementTemplatesService,
    private readonly agreements: AgreementsService,
  ) {}

  @Get('templates')
  @RequireAnyPermissions('settings.manage', 'finance.view_all', 'finance.create_invoice')
  listTemplates(@Query() query: ListTemplatesQueryDto) {
    return this.templates.list(query.includeInactive ?? false);
  }

  /** The {{TOKENS}} an author can drop into a template body. */
  @Get('templates/tokens')
  @RequireAnyPermissions('settings.manage', 'finance.view_all', 'finance.create_invoice')
  tokens() {
    return { tokens: this.templates.supportedTokens() };
  }

  /** Active templates for the Sales picker (minimal fields). */
  @Get('templates/options')
  @RequireAnyPermissions(
    'leads.update',
    'leads.create',
    'finance.view_all',
    'finance.create_invoice',
    'settings.manage',
  )
  templateOptions() {
    return this.agreements.templateOptions();
  }

  @Get('templates/:id')
  @RequireAnyPermissions('settings.manage', 'finance.view_all', 'finance.create_invoice')
  getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post('templates')
  @RequireAnyPermissions('settings.manage', 'finance.create_invoice')
  createTemplate(@Body() dto: CreateAgreementTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch('templates/:id')
  @RequireAnyPermissions('settings.manage', 'finance.create_invoice')
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementTemplateDto,
  ) {
    return this.templates.update(id, dto);
  }

  /**
   * Render the current editor content to a preview PDF (sample applicant
   * data). Returns base64 so the frontend can open it as a blob — no
   * storage clutter, auth handled by the normal JWT fetch.
   */
  @Post('templates/preview')
  @RequireAnyPermissions('settings.manage', 'finance.view_all', 'finance.create_invoice')
  async previewTemplate(@Body() dto: PreviewTemplateDto) {
    const buffer = await this.templates.previewPdf(dto);
    return { bytes: buffer.length, pdfBase64: buffer.toString('base64') };
  }

  // ─── Agreements (Sales authoring) ───────────────────────────────────────
  // NOTE: the ':id' routes below are declared AFTER every 'templates*' route
  // so a path like /agreements/templates is never captured as an :id.

  @Post()
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  createAgreement(
    @Body() dto: CreateAgreementDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.createDraft(dto, user.id);
  }

  @Get()
  @RequireAnyPermissions('leads.update', 'finance.view_all', 'settings.manage')
  listAgreements(
    @Query() query: ListAgreementsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const canViewAll = user.permissions.some((p) => VIEW_ALL_PERMS.includes(p));
    return this.agreements.list(query, user.id, canViewAll);
  }

  /**
   * Counts for sidebar badges (Finance "to review", Sales "needs changes").
   * Declared before ':id' so the literal path isn't parsed as a UUID.
   */
  @Get('review-counts')
  @RequireAnyPermissions('leads.update', 'finance.view_all', 'finance.create_invoice', 'settings.manage')
  reviewCounts(@CurrentUser() user: RequestUser) {
    return this.agreements.reviewCounts(user.id);
  }

  // ─── Admin: Signed Agreements correction console ──────────────────────────
  // Declared BEFORE ':id' so the literal 'signed/*' paths aren't parsed as a
  // UUID. Admin-only (super-admin holds settings.manage + finance.view_all).

  @Get('signed/list')
  @RequireAnyPermissions('settings.manage', 'finance.view_all')
  adminSignedList(@Query() query: AdminSignedListQueryDto) {
    return this.agreements.adminListSigned(query);
  }

  @Get('signed/stats')
  @RequireAnyPermissions('settings.manage', 'finance.view_all')
  adminSignedStats() {
    return this.agreements.adminSignedStats();
  }

  @Get('signed/:id')
  @RequireAnyPermissions('settings.manage', 'finance.view_all')
  adminSignedDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.adminSignedDetail(id);
  }

  // ─── Correction requests ──────────────────────────────────────────────────
  // The literal 'change-requests' GET must precede ':id' so it isn't parsed as
  // a UUID.

  @Get('change-requests')
  @RequireAnyPermissions('settings.manage', 'finance.view_all')
  listChangeRequests(@Query() query: ListChangeRequestsQueryDto) {
    return this.agreements.listChangeRequests(query);
  }

  @Post('change-requests/:id/reject')
  @RequireAnyPermissions('settings.manage', 'finance.view_all')
  rejectChangeRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectChangeRequestDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.rejectChangeRequest(id, user.id, dto.note);
  }

  /** Admin applies a pending correction. BIO → agreement + client/lead name +
   *  receipts; PAYMENT_PLAN → agreement + contract + installments + invoices +
   *  receipts (money already received is preserved). Same gate as viewing /
   *  rejecting, so anyone who can act on the queue can also apply. */
  @Post('change-requests/:id/apply')
  @RequireAnyPermissions('settings.manage', 'finance.view_all')
  applyChangeRequest(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.agreements.applyChangeRequest(id, user.id);
  }

  @Post('change-requests/:id/cancel')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  cancelChangeRequest(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    const canManageAll = user.permissions.some((p) => MANAGE_ALL_PERMS.includes(p));
    return this.agreements.cancelChangeRequest(id, user.id, canManageAll);
  }

  /** Rep raises a correction request on their own finalised agreement. */
  @Post(':id/change-requests')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  createChangeRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChangeRequestDto,
    @CurrentUser() user: RequestUser,
  ) {
    const canManageAll = user.permissions.some((p) => MANAGE_ALL_PERMS.includes(p));
    return this.agreements.createChangeRequest(id, user.id, dto, canManageAll);
  }

  @Get(':id')
  @RequireAnyPermissions('leads.update', 'finance.view_all', 'settings.manage')
  getAgreement(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    const canViewAll = user.permissions.some((p) => VIEW_ALL_PERMS.includes(p));
    return this.agreements.get(id, user.id, canViewAll);
  }

  @Patch(':id')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  updateAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.updateDraft(id, dto, user.id);
  }

  @Post(':id/preview')
  // PDF preview is Finance/admin only — the sales team must never obtain the
  // agreement file. Sales compose via the on-page live HTML preview, then submit.
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  async previewAgreement(@Param('id', ParseUUIDPipe) id: string) {
    const buffer = await this.agreements.previewPdf(id);
    return { bytes: buffer.length, pdfBase64: buffer.toString('base64') };
  }

  @Post(':id/submit')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  submitAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.submitToFinance(id, user.id);
  }

  /** Re-derive the document from template + current bio + plan. */
  @Post(':id/regenerate')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  regenerateAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.regenerate(id, user.id);
  }

  @Delete(':id')
  @RequireAnyPermissions('leads.update', 'finance.create_invoice', 'settings.manage')
  deleteAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.softDelete(id, user.id);
  }

  // ─── Finance review ─────────────────────────────────────────────────────

  @Post(':id/approve')
  @RequireAnyPermissions('finance.create_invoice', 'finance.verify_payment', 'settings.manage')
  approveAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.approve(id, user.id);
  }

  @Post(':id/request-changes')
  @RequireAnyPermissions('finance.create_invoice', 'finance.verify_payment', 'settings.manage')
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestChangesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.requestChanges(id, user.id, dto.note);
  }

  /** Finance sends the approved agreement PDF to the client → status SENT. */
  @Post(':id/send')
  @RequireAnyPermissions('finance.create_invoice', 'finance.verify_payment', 'settings.manage')
  sendToClient(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.agreements.sendToClient(id, user.id);
  }

  /**
   * Finance uploads the client's signed agreement PDF/image. This is the
   * moment the **ledger** (ServiceContract + Installments) materialises —
   * before this the agreement is just a finance-approved proposal awaiting
   * the client's signature.
   */
  @Post(':id/upload-signed')
  @RequireAnyPermissions('finance.create_invoice', 'finance.verify_payment', 'settings.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    }),
  )
  uploadSigned(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('Signed agreement file is required');
    return this.agreements.uploadSignedAgreement(id, file, user.id);
  }

  @Get(':id/pdf-url')
  // Finance/admin only — sales must never obtain the agreement PDF file.
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  @AuditDocumentAccess('Agreement', 'id')
  getPdfUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.getPdfUrl(id);
  }
}
