import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsBooleanString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';
import { WHATSAPP_QUEUE, type MediaDownloadJob } from '../queues/queue-contracts';
import { WhatsAppThreadsService } from './threads.service';

class ListThreadsDto {
  @IsOptional()
  @IsEnum(['OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED'])
  status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';

  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value === 'true' || value === true)
  assignedToMe?: boolean;

  /** Admin filter: "unassigned" returns only threads with no Lead.assignedEmployeeId. */
  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value === 'true' || value === true)
  unassigned?: boolean;

  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() cursor?: string;

  /**
   * Admin filter: only threads whose lead is assigned to this employee. Lets an
   * admin view a single agent's conversations (e.g. "Iffat's chats"). Only
   * honored for callers with whatsapp.view_all_inboxes. MUST be declared here —
   * the global ValidationPipe runs forbidNonWhitelisted, so an undeclared param
   * would 400 the whole request.
   */
  @IsOptional() @IsUUID() employeeId?: string;

  /**
   * Page size for the cursor-paginated list. Query params arrive as strings,
   * so coerce to a number before @IsInt runs. Bounded 1–100; the service
   * also clamps defensively. MUST be declared here — the global
   * ValidationPipe runs forbidNonWhitelisted, so an undeclared `limit`
   * param would 400 the whole request (which is exactly what blanked the
   * admin inbox).
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class ReassignThreadDto {
  /** The employee to route this thread's lead to. Must be an active WhatsApp inbox member. */
  @IsUUID()
  employeeId!: string;
}

@Controller('whatsapp/threads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppThreadsController {
  constructor(
    private readonly threads: WhatsAppThreadsService,
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
    private readonly storage: StorageService,
    @InjectQueue(WHATSAPP_QUEUE.MEDIA_DOWNLOAD)
    private readonly mediaQueue: Queue<MediaDownloadJob>,
  ) {}

  @Get()
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async list(@CurrentUser() user: RequestUser, @Query() q: ListThreadsDto) {
    const caller = await this.buildCallerContext(user);
    return this.threads.list(caller, q);
  }

  /**
   * True inbox counters for the KPI chips (Active / Unassigned / SLA breached
   * / Unread / Total). Computed with COUNT queries over the whole table so the
   * numbers reflect reality, not the 30-item first page. Mounted BEFORE the
   * @Get(':id') route so "stats" isn't parsed as a thread UUID.
   */
  @Get('stats')
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async stats(@CurrentUser() user: RequestUser) {
    const caller = await this.buildCallerContext(user);
    return this.threads.stats(caller);
  }

  @Get(':id')
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const caller = await this.buildCallerContext(user);
    return this.threads.getOrFail(caller, id);
  }

  @HttpCode(204)
  @Post(':id/read')
  @RequirePermissions('whatsapp.view_inbox')
  async markRead(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const caller = await this.buildCallerContext(user);
    await this.threads.markRead(caller, id);
  }

  /**
   * Per-thread AI on/off toggle. Flips WhatsAppThread.aiEnabled. When set
   * false, the AI orchestrator skips this thread regardless of the global
   * bot mode. Useful for sensitive conversations where the agent wants to
   * own every reply.
   */
  @Post(':id/ai-toggle')
  @RequirePermissions('whatsapp.send_message')
  async toggleAi(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { aiEnabled: boolean },
  ) {
    const caller = await this.buildCallerContext(user);
    // Use getOrFail so we apply the same role-scope checks as a read.
    await this.threads.getOrFail(caller, id);
    return this.prisma.whatsAppThread.update({
      where: { id },
      data: { aiEnabled: !!dto.aiEnabled },
      select: { id: true, aiEnabled: true, aiDisabledAt: true, aiState: true },
    });
  }

  /**
   * Pending AI-extracted appointment requests on this thread. Powers the
   * "Client wants Monday morning, video call" banner on the chat panel.
   */
  @Get(':id/appointment-requests')
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async appointmentRequests(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const caller = await this.buildCallerContext(user);
    await this.threads.getOrFail(caller, id);
    return this.prisma.appointmentRequest.findMany({
      where: { threadId: id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Admin override: reassign the thread's Lead to a specific employee. The
   * round-robin engine still applies on the next unassigned inbound, but
   * sticky routing (Lead.preferredEmployeeId) is updated so this becomes the
   * new home for the contact. Permission: whatsapp.reassign.
   */
  @Post(':id/reassign')
  @RequirePermissions('whatsapp.reassign')
  async reassign(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignThreadDto,
  ) {
    const caller = await this.buildCallerContext(user);
    return this.threads.reassign(caller, id, dto.employeeId);
  }

  /**
   * Stream a WhatsApp media attachment (image / audio / video / document)
   * through the backend, proxying from Meta's temporary CDN URL.
   *
   * - Images and audio are streamed inline (browser preview / audio player).
   * - Videos and documents are sent with Content-Disposition: attachment so
   *   the browser downloads to the user's device rather than opening inline.
   *
   * Permission: whatsapp.view_inbox (same as reading the thread itself).
   */
  @Get(':threadId/messages/:messageId/media')
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async streamMedia(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() res: Response,
  ): Promise<void> {
    const caller = await this.buildCallerContext(user);

    // Verify caller can see this thread.
    await this.threads.getOrFail(caller, threadId);

    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });
    if (!message || message.threadId !== threadId) {
      throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
    }

    type MediaPayload = { id?: string; mime_type?: string; filename?: string };
    const p = message.payload as Record<string, MediaPayload> | null;
    const typeKey = message.type.toLowerCase() as 'image' | 'audio' | 'video' | 'document' | 'sticker';
    const mediaMeta = p?.[typeKey];

    // Fast path — the media-download worker already re-hosted these bytes
    // to S3 when the inbound message arrived. `mediaUrl` either holds an S3
    // key (preferred — serve cached bytes) or a "meta:<id>" reference for
    // outbound voice notes we sent (need to re-fetch from Meta).
    const cachedKey =
      message.mediaUrl && !message.mediaUrl.startsWith('meta:') && !message.mediaUrl.startsWith('http')
        ? message.mediaUrl
        : null;

    let binary: Buffer;
    let mimeType: string;
    if (cachedKey) {
      const cached = await this.storage.download(cachedKey);
      binary = cached.bytes;
      mimeType = message.mediaMimeType ?? cached.mimeType ?? 'application/octet-stream';
    } else {
      // Slow path — bytes are not cached, ask Meta. This only works if the
      // channel's access token can still see the media (i.e., the media was
      // received under the SAME WABA as the channel's current token).
      const metaMediaId =
        mediaMeta?.id ??
        (message.mediaUrl?.startsWith('meta:') ? message.mediaUrl.slice(5) : null);
      if (!metaMediaId) {
        throw new HttpException('No media ID for this message', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const client = this.metaFactory.forChannel(message.channel);
      const { url: cdnUrl, mime_type } = await client.getMediaUrl(metaMediaId);
      binary = await client.downloadMedia(cdnUrl);
      mimeType = message.mediaMimeType ?? mime_type ?? 'application/octet-stream';
    }

    const filename = mediaMeta?.filename ?? `${typeKey}.${mimeType.split('/')[1] ?? 'bin'}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', binary.length);
    res.setHeader('Cache-Control', 'private, max-age=300');

    // Videos and documents must trigger a device download, not inline display.
    if (message.type === 'VIDEO' || message.type === 'DOCUMENT') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    res.end(binary);
  }

  /**
   * Re-trigger the media-download worker for a single message. Useful when
   * the original download failed (worker crash, transient Meta error,
   * temporary S3 outage) and the bytes are still fetchable from Meta — for
   * media that arrived under a still-valid channel token, this rescues the
   * message from a "Media unavailable" state.
   *
   * Returns 202 with the enqueued job id. The worker updates the message
   * row's `mediaUrl` when done; frontend can re-fetch after a short delay.
   */
  @HttpCode(202)
  @Post(':threadId/messages/:messageId/refetch-media')
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async refetchMedia(
    @CurrentUser() user: RequestUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<{ enqueued: boolean; jobId: string }> {
    const caller = await this.buildCallerContext(user);
    await this.threads.getOrFail(caller, threadId);

    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      select: { id: true, threadId: true, type: true, payload: true, mediaUrl: true },
    });
    if (!message || message.threadId !== threadId) {
      throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
    }

    type MediaPayload = { id?: string };
    const p = message.payload as Record<string, MediaPayload> | null;
    const typeKey = message.type.toLowerCase();
    const metaMediaId =
      p?.[typeKey]?.id ??
      (message.mediaUrl?.startsWith('meta:') ? message.mediaUrl.slice(5) : null);
    if (!metaMediaId) {
      throw new HttpException(
        'No Meta media id on this message — cannot refetch',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Bumps the jobId so BullMQ doesn't dedupe against the original
    // (which is likely still in the failed-jobs bucket).
    const jobId = `media-${messageId}-retry-${Date.now()}`;
    await this.mediaQueue.add(
      'download',
      { messageId, metaMediaId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 100 },
      },
    );
    return { enqueued: true, jobId };
  }

  /**
   * Resolve the calling user's employee row and whether they're allowed to
   * see threads not assigned to them. Permissions are evaluated by the
   * PermissionGuard before this runs, but we still need the role check to
   * scope query results.
   */
  private async buildCallerContext(user: RequestUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const perms = user.permissions ?? [];
    const canViewAll = perms.includes('whatsapp.view_all_inboxes');
    // Finance scope: see threads only for leads where Sales has already
    // sent an agreement (status != DRAFT). Narrower than view_all_inboxes
    // so finance can't peek into pre-agreement Sales negotiations.
    const canViewFinanceScope = !canViewAll && perms.includes('whatsapp.view_finance_scope');
    return {
      userId: user.id,
      employeeId: employee?.id ?? null,
      canViewAll,
      canViewFinanceScope,
    };
  }
}
