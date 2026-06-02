import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/auth.types';
import { WhatsAppCallsService } from './calls.service';

/**
 * Phase 1 softphone signaling endpoints. Auth = any logged-in employee; the
 * incoming-call event is already targeted to the assigned rep, so their dock
 * is the only one that knows the call id to act on.
 */
@Controller('whatsapp/calls')
@UseGuards(JwtAuthGuard)
export class WhatsAppCallsController {
  constructor(private readonly calls: WhatsAppCallsService) {}

  // Declared before ':id' so the literal route wins.
  @Get('ice')
  ice() {
    return this.calls.getIceServers();
  }

  // Admin calls history (org-wide). Declared before ':id' so these literal
  // routes win over the dock's UUID-param route. Gated to managers/admins.
  @Get('stats')
  @UseGuards(PermissionGuard)
  @RequireAnyPermissions('whatsapp.view_all_inboxes')
  stats() {
    return this.calls.callStats();
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequireAnyPermissions('whatsapp.view_all_inboxes')
  history(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('direction') direction?: string,
    @Query('status') status?: string,
  ) {
    return this.calls.listHistory({
      limit: limit ? Number(limit) : undefined,
      before: before ? new Date(before) : undefined,
      direction: direction || undefined,
      status: status || undefined,
    });
  }

  // ── Outbound (business-initiated) calling ────────────────────────────────
  // Any authenticated employee may request permission / place a call for a
  // conversation (same auth as the inbound answer/reject/hangup actions).
  @Post('permission')
  requestPermission(@Body() body: { threadId: string }, @CurrentUser() user: RequestUser) {
    return this.calls.requestCallPermission(body?.threadId, user.id);
  }

  @Post('outbound')
  outbound(
    @Body() body: { threadId: string; sdpOffer: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.calls.initiateOutbound(body?.threadId, body?.sdpOffer, user.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.calls.getForDock(id);
  }

  @Post(':id/answer')
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { sdpAnswer: string },
    @CurrentUser() user: RequestUser,
  ) {
    return this.calls.answer(id, body?.sdpAnswer, user.id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.calls.reject(id);
  }

  @Post(':id/hangup')
  hangup(@Param('id', ParseUUIDPipe) id: string) {
    return this.calls.hangup(id);
  }

  // Recording upload (rep's browser, on hang-up). Any authenticated employee —
  // they're uploading their own call. 64MB cap (opus audio is tiny).
  @Post(':id/recording')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 64 * 1024 * 1024 } }))
  recording(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) return { error: 'No file uploaded' };
    return this.calls.saveRecording(id, file.buffer, file.mimetype, file.originalname);
  }

  // Signed URL to play/download the recording — admin/manager only.
  @Get(':id/recording')
  @UseGuards(PermissionGuard)
  @RequireAnyPermissions('whatsapp.view_all_inboxes')
  recordingUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.calls.recordingSignedUrl(id);
  }
}
