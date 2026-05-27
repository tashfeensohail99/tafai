import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { NotificationsService } from './notifications.service';

/**
 * Per-user notification endpoints. JWT-gated only — no permission key needed
 * since these are personal to the caller (the service always scopes by the
 * authenticated userId).
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.service.list(user.id, Number.isFinite(n) ? n : 20);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    return { count: await this.service.unreadCount(user.id) };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.markRead(user.id, id);
    return { ok: true };
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.service.markAllRead(user.id);
  }
}
