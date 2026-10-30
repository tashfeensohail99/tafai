import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { SocialEngagementService } from './social-engagement.service';
import { SelfHandlesDto } from './social-engagement.dto';

/**
 * Authenticated self-service for the in-app "register your social profiles"
 * popup. Any logged-in employee may read their own submission status and submit
 * their own handles — the employee is resolved from the JWT, so no permission
 * is required (every employee is prompted) and no name/phone is needed.
 */
@Controller('social-engagement/me')
@UseGuards(JwtAuthGuard)
export class SelfSocialHandlesController {
  constructor(private readonly svc: SocialEngagementService) {}

  @Get('handle-status')
  status(@CurrentUser() user: RequestUser) {
    return this.svc.myHandleStatus(user.id);
  }

  @Post('handles')
  submit(@CurrentUser() user: RequestUser, @Body() dto: SelfHandlesDto) {
    return this.svc.submitMyHandles(user.id, dto);
  }
}
