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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementsService } from './agreements.service';
import {
  CreateAgreementDto,
  CreateAgreementTemplateDto,
  ListAgreementsQueryDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  RequestChangesDto,
  UpdateAgreementDto,
  UpdateAgreementTemplateDto,
} from './agreements.dto';

/** Permissions that grant a cross-agent view of agreements. */
const VIEW_ALL_PERMS = ['finance.view_all', 'leads.view_all', 'settings.manage'];

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

  @Get(':id')
  @RequireAnyPermissions('leads.update', 'finance.view_all', 'settings.manage')
  getAgreement(@Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.get(id);
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
  @RequireAnyPermissions('leads.update', 'finance.view_all', 'settings.manage')
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

  @Get(':id/pdf-url')
  @RequireAnyPermissions('leads.update', 'finance.view_all', 'settings.manage')
  getPdfUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.getPdfUrl(id);
  }
}
