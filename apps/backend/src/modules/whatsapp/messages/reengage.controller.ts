import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { WhatsAppMessagesService } from './messages.service';

const DEFAULT_TEMPLATE = 'immigration_enquiry_update';
const DEFAULT_LANGUAGE = 'en';

class ReengageRunDto {
  @IsOptional() @IsString() @MinLength(1) templateName?: string;
  @IsOptional() @IsString() @MinLength(2) language?: string;
  @IsInt() @Min(1) @Max(500) limit!: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) staggerMs?: number;
}

/**
 * Admin-only re-engagement batch sender for the dormant-lead backlog.
 * Sends the approved re-engagement TEMPLATE to the next batch of uncontacted,
 * window-closed leads — idempotent (never double-messages a thread), staggered,
 * and capped at 500/run. Manager/admin scope only (whatsapp.view_all_inboxes).
 *
 * Run with dryRun=true first to preview the count + sample names without sending.
 */
@Controller('whatsapp/admin/reengage')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppReengageController {
  constructor(private readonly messages: WhatsAppMessagesService) {}

  @Get('stats')
  @RequirePermissions('whatsapp.view_all_inboxes')
  async stats(@Query('templateName') templateName?: string) {
    return this.messages.reengageStats(templateName || DEFAULT_TEMPLATE);
  }

  @Post('run')
  @RequirePermissions('whatsapp.view_all_inboxes')
  async run(@Body() dto: ReengageRunDto) {
    return this.messages.reengageDormantBatch({
      templateName: dto.templateName || DEFAULT_TEMPLATE,
      language: dto.language || DEFAULT_LANGUAGE,
      limit: dto.limit,
      dryRun: dto.dryRun ?? false,
      staggerMs: dto.staggerMs,
    });
  }
}
