import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Audit } from '../../../common/decorators/audit.decorator';
import { WhatsAppMessagesService } from './messages.service';
import { TemplateComponentDto } from './template-component.dto';

class SendLeadTemplateDto {
  @IsOptional() @IsString() templateName?: string;
  @IsOptional() @IsString() language?: string;
  /**
   * Meta components for the chosen template. Sent by the CSV-leads / lead
   * template picker, where the rep picks ANY approved template and fills its
   * placeholders — so the param count must follow the template, not a
   * hardcoded shape. Omitted by the mobile one-tap path, which keeps the
   * legacy 2-param `reengage_personal` default.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentDto)
  components?: TemplateComponentDto[];
  @IsOptional() @IsString() idempotencyKey?: string;
}

/**
 * Lead-keyed WhatsApp outreach. Sends an approved CRM template to a lead from
 * the business number, creating the WhatsApp thread on first contact — so a rep
 * makes first contact ON the CRM number (logged, on-brand) instead of opening
 * their personal WhatsApp. All existing send routes are thread-id keyed; this
 * is the lead-keyed entry that resolves/creates the thread server-side.
 */
@Controller('whatsapp/leads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppLeadOutreachController {
  constructor(
    private readonly messages: WhatsAppMessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':leadId/send-template')
  @RequirePermissions('whatsapp.send_message')
  @Audit({
    entityType: 'WhatsAppThread',
    category: 'MUTATION',
    severity: 'HIGH',
    idParam: 'leadId',
    action: 'WHATSAPP_MESSAGE_SENT',
  })
  async sendTemplateToLead(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: SendLeadTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    const caller = await this.callerContext(user);
    return this.messages.sendTemplateToLead(caller, {
      leadId,
      ...dto,
      // Validated nested DTO instances — structurally the Meta components JSON.
      components: dto.components as unknown as Array<Record<string, unknown>> | undefined,
    });
  }

  /** Mirror of messages.controller.callerContext — builds the WhatsApp scope
   *  flags from the JWT permissions + the caller's employee row. */
  private async callerContext(user: RequestUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const perms = user.permissions ?? [];
    const canViewAll = perms.includes('whatsapp.view_all_inboxes');
    const canViewFinanceScope = !canViewAll && perms.includes('whatsapp.view_finance_scope');
    const canViewProcessingScope = !canViewAll && perms.includes('whatsapp.view_processing_scope');
    return {
      userId: user.id,
      employeeId: employee?.id ?? null,
      canViewAll,
      canViewFinanceScope,
      canViewProcessingScope,
    };
  }
}
