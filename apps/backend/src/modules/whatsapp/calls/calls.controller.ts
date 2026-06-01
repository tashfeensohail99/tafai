import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
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
