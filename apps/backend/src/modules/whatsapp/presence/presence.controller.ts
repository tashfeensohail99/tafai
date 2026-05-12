import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { PresenceStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../common/types/auth.types';
import { WhatsAppPresenceService } from './presence.service';

class SetPresenceDto {
  @IsEnum(PresenceStatus)
  status!: PresenceStatus;
}

/**
 * Routes:
 *   GET    /whatsapp/presence/me             effective + explicit presence for caller
 *   PATCH  /whatsapp/presence/me             agent toggles their presence
 *   POST   /whatsapp/presence/heartbeat      cheap ping every ~60s from the UI
 *   GET    /whatsapp/presence/team           manager dashboard view (live load)
 */
@Controller('whatsapp/presence')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WhatsAppPresenceController {
  constructor(private readonly presence: WhatsAppPresenceService) {}

  @Get('me')
  @RequirePermissions('whatsapp.view_inbox')
  async me(@CurrentUser() user: RequestUser) {
    return this.presence.getMine(user.id);
  }

  @Patch('me')
  @RequirePermissions('whatsapp.view_inbox')
  async setMine(@CurrentUser() user: RequestUser, @Body() dto: SetPresenceDto) {
    await this.presence.setExplicit(user.id, dto.status);
    return this.presence.getMine(user.id);
  }

  @HttpCode(204)
  @Post('heartbeat')
  @RequirePermissions('whatsapp.view_inbox')
  async heartbeat(@CurrentUser() user: RequestUser) {
    await this.presence.heartbeat(user.id);
  }

  @Get('team')
  @RequirePermissions('whatsapp.view_team_dashboard')
  async team() {
    return this.presence.listTeam();
  }
}
