import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SocialEngagementService } from './social-engagement.service';
import { PublicIntakeDto } from './social-engagement.dto';

/**
 * PUBLIC (no CRM login) endpoints backing the employee self-submit page at
 * /onboarding/social-handles/<token>. The opaque HMAC-signed token identifies
 * exactly one employee, so a holder can only read/write THAT employee's social
 * handles and nothing else — no login, no other data reachable. Deliberately
 * has no JwtAuthGuard (auth is per-controller in this app — see
 * PublicDownloadsController / PublicConsultPayController). Rate-limited via
 * ThrottlerGuard since it is unauthenticated.
 */
@UseGuards(ThrottlerGuard)
@Controller('public/social-handles')
export class PublicSocialHandlesController {
  constructor(private readonly svc: SocialEngagementService) {}

  /** Prefill: the employee's name + any handles already on file. */
  @Get(':token')
  info(@Param('token') token: string) {
    return this.svc.getPublicIntake(token);
  }

  /** Submit/resubmit handles. Tighter throttle than the controller default. */
  @Post(':token')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  submit(@Param('token') token: string, @Body() dto: PublicIntakeDto) {
    return this.svc.submitPublicIntake(token, dto);
  }
}
