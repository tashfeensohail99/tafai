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
import { IsBooleanString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';
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
  ) {}

  @Get()
  @RequireAnyPermissions('whatsapp.view_inbox', 'whatsapp.view_all_inboxes')
  async list(@CurrentUser() user: RequestUser, @Query() q: ListThreadsDto) {
    const caller = await this.buildCallerContext(user);
    return this.threads.list(caller, q);
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

    // Extract the Meta media ID from the payload based on message type.
    // Inbound messages: media ID is in payload.audio.id (set by webhook ingest).
    // Outbound messages we sent: media ID is in mediaUrl as "meta:<id>".
    type MediaPayload = { id?: string; mime_type?: string; filename?: string };
    const p = message.payload as Record<string, MediaPayload> | null;
    const typeKey = message.type.toLowerCase() as 'image' | 'audio' | 'video' | 'document' | 'sticker';
    const mediaMeta = p?.[typeKey];
    const metaMediaId =
      mediaMeta?.id ??
      (message.mediaUrl?.startsWith('meta:') ? message.mediaUrl.slice(5) : null);

    if (!metaMediaId) {
      throw new HttpException('No media ID for this message', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const client = this.metaFactory.forChannel(message.channel);

    // Step 1: Resolve the temporary CDN URL from Meta.
    const { url: cdnUrl, mime_type } = await client.getMediaUrl(metaMediaId);

    // Step 2: Fetch the binary from Meta's CDN.
    const binary = await client.downloadMedia(cdnUrl);

    const mimeType = message.mediaMimeType ?? mime_type ?? 'application/octet-stream';
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
    const canViewAll = (user.permissions ?? []).includes('whatsapp.view_all_inboxes');
    return {
      userId: user.id,
      employeeId: employee?.id ?? null,
      canViewAll,
    };
  }
}
