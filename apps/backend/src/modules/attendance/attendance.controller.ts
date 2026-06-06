import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AttendanceClient } from './attendance.client';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto, SyncAttendanceDto } from './attendance.dto';

/**
 * Admin-facing attendance endpoints. All gated to `attendance.view` (admin-only
 * per the seed grant). The camera side is read-only; here we pull the camera's
 * computed daily attendance into core.attendance_records, expose it for viewing,
 * and allow manual marking / override.
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttendanceController {
  constructor(
    private readonly client: AttendanceClient,
    private readonly attendance: AttendanceService,
  ) {}

  /** Confirms the camera API is reachable + credentials work. */
  @Get('ping')
  @RequirePermissions('attendance.view')
  async ping(): Promise<{ configured: boolean; ok: boolean; employeeCount?: number; error?: string }> {
    const result = await this.client.ping();
    return { configured: this.client.configured, ...result };
  }

  /** Daily board — every active employee + their attendance for `date` (default: today PKT). */
  @Get('daily')
  @RequirePermissions('attendance.view')
  async daily(@Query('date') date?: string) {
    const d =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
    return this.attendance.listDaily(d);
  }

  /** One employee's attendance over a date range. */
  @Get('records')
  @RequirePermissions('attendance.view')
  async records(
    @Query('employeeId') employeeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.attendance.listByEmployee(employeeId, from, to);
  }

  /** Pull attendance from the camera for a date (or range) and store it. */
  @Post('sync')
  @RequirePermissions('attendance.view')
  async sync(@Body() dto: SyncAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendance.sync(dto, user.id);
  }

  /** Manually set / correct one employee's attendance for a day (override). */
  @Post('mark')
  @RequirePermissions('attendance.view')
  async mark(@Body() dto: MarkAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendance.mark(dto, user.id);
  }
}
