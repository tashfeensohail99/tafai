import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { ActivityTimelineService } from './activity-timeline.service';
import { ListActivityTimelineQueryDto } from './activity-timeline.dto';

@Controller('activity-timeline')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ActivityTimelineController {
  constructor(private readonly activityTimelineService: ActivityTimelineService) {}

  /**
   * Read the activity timeline. Used by the lead profile's Activity tab
   * (sales + admin) and by the admin reports view.
   *
   * Permission: any of leads.view_all (admin), leads.view_assigned (sales),
   * or reports.view (analytics roles). The frontend always filters by the
   * specific leadId/clientId being viewed, and the upstream lead-detail
   * endpoint already enforces scope on what leads each user can open —
   * so trusting the query here is safe: a sales rep without view_all
   * can only ever pass leadIds they're authorised to fetch in the first
   * place.
   */
  @Get()
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned', 'reports.view')
  findAll(@Query() query: ListActivityTimelineQueryDto) {
    if (query.entityType && query.entityId) {
      return this.activityTimelineService.getForEntity(query.entityType, query.entityId);
    }

    return this.activityTimelineService.findMany(query);
  }
}