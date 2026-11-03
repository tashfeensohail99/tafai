import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SocialEngagementService } from './social-engagement.service';
import { IntakePickDto, IntakeSearchDto, PublicIntakeDto } from './social-engagement.dto';

/**
 * PUBLIC (no CRM login) endpoints behind the ONE shared self-submit page at
 * /onboarding/social-handles. Employees FIND THEIR NAME in a search box and
 * pick themselves — no brittle name+phone "login". The pick carries an opaque
 * signed token (not a per-person link) that resolves to the employee
 * server-side; a submission only ever writes that employee's social-handle
 * columns. Deliberately no JwtAuthGuard (auth is per-controller here) and
 * ThrottlerGuard rate-limited since it is unauthenticated.
 */
@UseGuards(ThrottlerGuard)
@Controller('public/social-handles')
export class PublicSocialHandlesController {
  constructor(private readonly svc: SocialEngagementService) {}

  /** Step 1 — type your name, get matching staff (+ a signed pick token each). */
  @Post('search')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  search(@Body() dto: IntakeSearchDto) {
    return this.svc.searchEmployeesForIntake(dto.q);
  }

  /** Step 2a — after picking, prefill name + any handles already on file. */
  @Post('prefill')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  prefill(@Body() dto: IntakePickDto) {
    return this.svc.prefillByPick(dto.pickToken);
  }

  /** Step 2b — submit/resubmit handles for the picked employee. */
  @Post('submit')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submit(@Body() dto: PublicIntakeDto) {
    return this.svc.submitByPick(dto);
  }
}
