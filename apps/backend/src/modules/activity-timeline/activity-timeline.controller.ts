import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActivityTimelineService } from './activity-timeline.service';
import { ListActivityTimelineQueryDto } from './activity-timeline.dto';

@Controller('activity-timeline')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ActivityTimelineController {
  constructor(private readonly activityTimelineService: ActivityTimelineService) {}

  @Get()
  @RequirePermissions('reports.view')
  findAll(@Query() query: ListActivityTimelineQueryDto) {
    if (query.entityType && query.entityId) {
      return this.activityTimelineService.getForEntity(query.entityType, query.entityId);
    }

    return this.activityTimelineService.findMany(query);
  }
}