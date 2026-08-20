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
import { JudicialReviewService } from './judicial-review.service';
import {
  AssignMatterDto,
  ChangeStageDto,
  ClearConflictReviewDto,
  DetermineRouteDto,
  ListMattersQueryDto,
  RecordMeritsDto,
  SetCounselOfRecordDto,
  UpdateMatterDto,
} from './judicial-review.dto';

/**
 * Judicial Review matters. PR 3 adds the gated stage machine (§6.1 + §6.2), the
 * route decision tree (§6.4), non-gated field edits, assignment, merits, counsel
 * of record and conflict-review clearing. Intake (POST /jr/matters) is PR 5;
 * settlement / successor are PR 6. Every handler is permission-gated AND
 * re-checks matter-level access in the service (never relies on list scoping
 * alone — #253/#255). Each mutation carries an explicit @Audit decorator because
 * the global interceptor's ID_PARAM_PRIORITY has no `matterId` — without it the
 * audit row's entityId is null.
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

  // Declared BEFORE `@Get(':id')` so the static `associates` path wins over the
  // `:id` UUID param route. Powers the Head console's assign dropdown.
  @Get('associates')
  @RequirePermissions('jr.matter.assign')
  associates() {
    return this.jr.listAssociates();
  }

  @Get(':id')
  @RequirePermissions('jr.portal.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.jr.getMatterDetail(id, user);
  }

  // ---- The gated stage machine + route tree --------------------------------

  @Patch(':matterId/stage')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  changeStage(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: ChangeStageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.changeMatterStage(matterId, dto, user);
  }

  @Post(':matterId/route')
  @RequirePermissions('jr.route.determine')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  route(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: DetermineRouteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.determineRoute(matterId, dto, user);
  }

  // ---- Non-gated edits + assignment ----------------------------------------

  @Patch(':matterId')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'MEDIUM' })
  update(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: UpdateMatterDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.updateMatter(matterId, dto, user);
  }

  @Patch(':matterId/assign')
  @RequirePermissions('jr.matter.assign')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'MEDIUM' })
  assign(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: AssignMatterDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.assignMatter(matterId, dto, user);
  }

  // ---- Merits + counsel + conflict review ----------------------------------

  @Post(':matterId/merits')
  @RequirePermissions('jr.counsel.manage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  merits(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: RecordMeritsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.recordMerits(matterId, dto, user);
  }

  @Post(':matterId/conflict-review')
  @RequirePermissions('jr.matter.assign')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  conflictReview(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: ClearConflictReviewDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.clearConflictReview(matterId, dto, user);
  }

  @Post(':matterId/counsel')
  @RequirePermissions('jr.counsel.manage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'HIGH' })
  setCounsel(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Body() dto: SetCounselOfRecordDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.setCounselOfRecord(matterId, dto, user);
  }

  // ---- CLIENT_UNRESPONSIVE (bypasses the map) ------------------------------

  @Post(':matterId/unresponsive')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'MEDIUM' })
  unresponsive(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.markUnresponsive(matterId, user);
  }

  @Post(':matterId/resume')
  @RequirePermissions('jr.matter.update_stage')
  @Audit({ idParam: 'matterId', entityType: 'JrMatter', category: 'MUTATION', severity: 'MEDIUM' })
  resume(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.jr.resumeFromUnresponsive(matterId, user);
  }
}
