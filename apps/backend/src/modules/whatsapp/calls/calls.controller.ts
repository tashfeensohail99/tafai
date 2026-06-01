import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
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
}
