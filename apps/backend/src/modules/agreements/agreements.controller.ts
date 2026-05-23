import {
  Body,
  Controller,
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
import { AgreementTemplatesService } from './agreement-templates.service';
import {
  CreateAgreementTemplateDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  UpdateAgreementTemplateDto,
} from './agreements.dto';

/**
 * Slice 1 — Agreement template authoring (admin/finance). Sales-side
 * authoring and the Finance review workflow are added in later slices.
 */
@Controller('agreements')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AgreementsController {
  constructor(private readonly templates: AgreementTemplatesService) {}

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
}
