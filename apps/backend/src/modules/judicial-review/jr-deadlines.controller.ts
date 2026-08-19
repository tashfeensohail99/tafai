import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JrDeadlinesService } from './jr-deadlines.service';
import {
  DeadlineBoardQueryDto,
  OverrideDeadlineDto,
  UnderlyingDocWatchDto,
  VerifyRuleDto,
} from './judicial-review.dto';

/**
 * The JR deadline engine's HTTP surface (PR 4): per-matter deadlines + recompute,
 * the cross-matter board, override / satisfy, the underlying-doc watch, and the
 * Head's rule-verification view. Every handler is permission-gated AND re-checks
 * matter-level access in the service (never relies on list scoping alone —
 * #253/#255). Each mutation carries an explicit @Audit decorator because the
 * global interceptor's ID_PARAM_PRIORITY has no `matterId` — without it the audit
 * row's entityId is null.
 */
@Controller('jr')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JrDeadlinesController {
  constructor(private readonly deadlines: JrDeadlinesService) {}

  // ---- Per-matter deadlines -------------------------------------------------

  @Get('matters/:matterId/deadlines')
  @RequireAnyPermissions('jr.matter.view_assigned', 'jr.matter.view_all')
  list(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deadlines.listMatterDeadlines(matterId, user);
  }

  @Post('matters/:matterId/deadlines/recompute')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'LOW' })
  async recompute(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: RequestUser,
  ) {
    // recomputeForUser access-checks the matter AND locks its row before writing —
    // never rely on the trailing read alone (#253/#255).
    await this.deadlines.recomputeForUser(matterId, user);
    return this.deadlines.listMatterDeadlines(matterId, user);
  }

  @Post('matters/:matterId/deadlines/underlying-doc')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'MEDIUM' })
  addUnderlyingDoc(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: UnderlyingDocWatchDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deadlines.addUnderlyingDocWatch(matterId, dto, user);
  }

  // ---- Cross-matter board ---------------------------------------------------

  @Get('board')
  @RequireAnyPermissions('jr.matter.view_assigned', 'jr.matter.view_all')
  board(@Query() query: DeadlineBoardQueryDto, @CurrentUser() user: RequestUser) {
    return this.deadlines.listBoard(user, {
      fatalOnly: query.fatalOnly === 'true',
      take: query.take,
    });
  }

  // ---- Override / satisfy ---------------------------------------------------

  @Patch('deadlines/:id/override')
  @RequirePermissions('jr.deadline.override')
  @Audit({ idParam: 'id', entityType: 'JrDeadline', category: 'MUTATION', severity: 'HIGH' })
  override(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideDeadlineDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deadlines.overrideDeadline(id, dto, user);
  }

  @Post('deadlines/:id/satisfy')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'id', entityType: 'JrDeadline', category: 'MUTATION', severity: 'MEDIUM' })
  satisfy(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.deadlines.satisfyDeadline(id, user);
  }

  // ---- Rules (the Head's verification view) ---------------------------------

  @Get('rules')
  @RequirePermissions('jr.rules.manage')
  rules(@CurrentUser() user: RequestUser) {
    return this.deadlines.listRules(user);
  }

  @Patch('rules/:id/verify')
  @RequirePermissions('jr.rules.manage')
  @Audit({ idParam: 'id', entityType: 'JrDeadlineRule', category: 'MUTATION', severity: 'CRITICAL' })
  verifyRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyRuleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.deadlines.verifyRule(id, dto, user);
  }
}
