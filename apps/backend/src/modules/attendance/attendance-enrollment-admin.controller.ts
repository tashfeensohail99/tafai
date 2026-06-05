import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AttendanceEnrollmentService } from './attendance-enrollment.service';
import {
  ApproveEnrollmentDto,
  RejectEnrollmentDto,
  UpdateEnrollmentSettingsDto,
} from './attendance-enrollment.dto';

/**
 * Admin review queue for camera-initiated enrollment requests + the master
 * on/off switch. Reuses the existing employees.* permissions (admins already
 * have them) so no new permission/re-login is required.
 *   GET   /attendance/enrollment/settings
 *   PATCH /attendance/enrollment/settings           { enabled }
 *   GET   /attendance/enrollment/requests?status=
 *   POST  /attendance/enrollment/requests/:id/approve
 *   POST  /attendance/enrollment/requests/:id/reject
 */
@Controller('attendance/enrollment')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttendanceEnrollmentAdminController {
  constructor(private readonly enrollment: AttendanceEnrollmentService) {}

  @Get('settings')
  @RequirePermissions('employees.view_all')
  getSettings() {
    return this.enrollment.getSettings();
  }

  @Patch('settings')
  @RequirePermissions('employees.create')
  setSettings(@Body() dto: UpdateEnrollmentSettingsDto) {
    return this.enrollment.setEnabled(dto.enabled);
  }

  @Get('requests')
  @RequirePermissions('employees.view_all')
  list(@Query('status') status?: string) {
    return this.enrollment.list(status);
  }

  @Post('requests/:id/approve')
  @RequirePermissions('employees.create')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveEnrollmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.enrollment.approve(id, dto, user.id);
  }

  @Post('requests/:id/reject')
  @RequirePermissions('employees.create')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectEnrollmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.enrollment.reject(id, dto.reason, user.id);
  }
}
