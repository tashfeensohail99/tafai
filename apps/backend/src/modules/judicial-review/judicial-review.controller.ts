import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { JudicialReviewService } from './judicial-review.service';
import { ListMattersQueryDto } from './judicial-review.dto';

/**
 * Judicial Review matters. Read-only in PR 1 — the stage machine, route tree
 * and deadline engine land in later PRs. Every handler is permission-gated AND
 * re-checks matter-level access in the service (never relies on list scoping
 * alone — #253/#255).
 */
@Controller('jr/matters')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class JudicialReviewController {
  constructor(private readonly jr: JudicialReviewService) {}

  @Get()
  @RequireAnyPermissions('jr.matter.view_assigned', 'jr.matter.view_all')
  list(@Query() query: ListMattersQueryDto, @CurrentUser() user: RequestUser) {
    return this.jr.listMatters(query, user);
  }

  @Get(':id')
  @RequirePermissions('jr.portal.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.jr.getMatter(id, user);
  }
}
