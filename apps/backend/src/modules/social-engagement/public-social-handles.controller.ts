import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SocialEngagementService } from './social-engagement.service';
import { LookupByEmailDto, PublicIntakeDto } from './social-engagement.dto';

/**
 * PUBLIC (no CRM login) endpoints behind the ONE shared self-submit page at
 * /onboarding/social-handles. Employees identify themselves by their work
 * email, which maps to their Employee record — no per-person links, no roster
 * exposed, and a submission only ever writes the social-handle columns of the
 * matched employee. Deliberately has no JwtAuthGuard (auth is per-controller in
 * this app — see PublicDownloadsController / PublicConsultPayController) and is
 * ThrottlerGuard rate-limited since it is unauthenticated.
 */
@UseGuards(ThrottlerGuard)
@Controller('public/social-handles')
export class PublicSocialHandlesController {
  constructor(private readonly svc: SocialEngagementService) {}

  /** Step 1 — confirm the email maps to a team member + prefill their handles. */
  @Post('lookup')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  lookup(@Body() dto: LookupByEmailDto) {
    return this.svc.lookupByEmail(dto.email);
  }

  /** Step 2 — submit/resubmit handles for the employee behind the email. */
  @Post('submit')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  submit(@Body() dto: PublicIntakeDto) {
    return this.svc.submitByEmail(dto);
  }
}
