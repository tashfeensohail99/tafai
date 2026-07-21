import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { WhatsAppChannelStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { WhatsAppChannelsService } from './channels.service';
import { Audit } from '../../../common/decorators/audit.decorator';
import { WHATSAPP_QUEUE, type TemplateSyncJob } from '../queues/queue-contracts';

class UpsertChannelDto {
  @IsString() @MinLength(1) label!: string;
  @IsString() @MinLength(1) wabaId!: string;
  @IsString() @MinLength(1) phoneNumberId!: string;
  @IsString() @MinLength(1) displayNumber!: string;
  @IsString() @MinLength(20) accessToken!: string;
}

class UpdateChannelStatusDto {
  @IsEnum(WhatsAppChannelStatus) status!: WhatsAppChannelStatus;
  @IsOptional() @IsString() reason?: string;
}

/**
 * Admin-only endpoints for managing WhatsApp Business numbers. The token is
 * encrypted before storage; we never return it.
 *
 * Routes (auto-prefixed with /v1 by the global prefix):
 *   GET    /whatsapp/channels
 *   POST   /whatsapp/channels           upsert by phone_number_id
 *   PATCH  /whatsapp/channels/:id/status
 */
@Controller('whatsapp/channels')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppChannelsController {
  constructor(
    private readonly channels: WhatsAppChannelsService,
    private readonly config: ConfigService,
    @InjectQueue(WHATSAPP_QUEUE.TEMPLATE_SYNC)
    private readonly templateSyncQueue: Queue<TemplateSyncJob>,
  ) {}

  @Get()
  @RequirePermissions('whatsapp.manage_channels')
  async list() {
    return this.channels.list();
  }

  /**
   * The ACTIVE sending channel's id — the one lookup a plain rep needs before
   * they can list templates (GET /whatsapp/channels/:channelId/templates) for
   * a lead who has no thread yet, e.g. first contact from the CSV-leads page.
   * Deliberately NOT the admin `list()`: it returns only the id + display
   * number, never tokens or WABA identifiers, and is gated on send permission
   * rather than channel management. Mirrors the server-side channel pick in
   * messages.service.sendTemplateToLead (first ACTIVE by createdAt) so the
   * templates the rep browses are the ones the send will actually use.
   */
  @Get('active')
  @RequireAnyPermissions('whatsapp.send_message', 'whatsapp.view_all_inboxes')
  async active() {
    return this.channels.activeForSending();
  }

  /**
   * Admin Settings → Integrations page reads this on mount to render:
   *   - the exact webhook callback URL to paste into Meta (server-side
   *     truth, no hardcoded Railway hostnames in the frontend)
   *   - whether the security-critical env vars are configured so the
   *     admin sees red/green at a glance without exposing secret values
   *   - the Graph API version pin so docs match runtime
   */
  @Get('integration-info')
  @RequirePermissions('whatsapp.manage_channels')
  async integrationInfo() {
    const appUrl =
      this.config.get<string>('app.appUrl')?.replace(/\/+$/, '') ?? '';
    return {
      webhookUrl: appUrl ? `${appUrl}/v1/whatsapp/webhooks/meta` : null,
      apiVersion:
        this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0',
      metaAppId: this.config.get<string>('app.whatsapp.metaAppId') ?? null,
      env: {
        verifyTokenConfigured: Boolean(
          this.config.get<string>('app.whatsapp.webhookVerifyToken'),
        ),
        appSecretConfigured: Boolean(
          this.config.get<string>('app.whatsapp.metaAppSecret'),
        ),
        encryptionKeyConfigured: Boolean(
          this.config.get<string>('app.whatsapp.encryptionKey'),
        ),
      },
    };
  }

  @Audit({ entityType: 'WhatsAppChannel', category: 'CONFIG', severity: 'CRITICAL', action: 'SETTING_CHANGED' })
  @Post()
  @RequirePermissions('whatsapp.manage_channels')
  async upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertChannelDto) {
    return this.channels.upsert(user.id, dto);
  }

  /**
   * Test connection — admin clicks "Verify connection" in Settings →
   * Integrations and we ping Meta's Graph API with the stored token to
   * confirm the credentials still work. Returns the Meta-reported state
   * of the phone number (verified name, quality rating, messaging tier)
   * so the operator sees a definitive answer.
   */
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('whatsapp.manage_channels')
  async verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.verify(id);
  }

  @Audit({ entityType: 'WhatsAppChannel', category: 'CONFIG', severity: 'HIGH', idParam: 'id', action: 'SETTING_CHANGED' })
  @Patch(':id/status')
  @RequirePermissions('whatsapp.manage_channels')
  async setStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelStatusDto,
  ) {
    return this.channels.setStatus(user.id, id, dto.status);
  }

  /**
   * Enqueue a Meta template re-sync for this channel. The TemplateSyncProcessor
   * pulls the full approved-template list from Meta and upserts the local
   * `whatsapp.templates` rows. Idempotent — safe to call repeatedly.
   *
   * Returns 202 (Accepted) with the BullMQ job id so the UI can show "queued".
   */
  @Post(':id/sync-templates')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('whatsapp.manage_templates')
  async syncTemplates(@Param('id', ParseUUIDPipe) id: string) {
    // Verify the channel exists so we 404 instead of silently enqueueing.
    await this.channels.getOrFail(id);
    const job = await this.templateSyncQueue.add(
      'sync',
      { channelId: id },
      { jobId: `template-sync-${id}-${Date.now()}` },
    );
    return { jobId: job.id, channelId: id, queuedAt: new Date().toISOString() };
  }
}
