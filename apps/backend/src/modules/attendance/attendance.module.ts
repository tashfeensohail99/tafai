import { Module } from '@nestjs/common';
import { AttendanceClient } from './attendance.client';
import { AttendanceController } from './attendance.controller';
import { AttendanceDirectoryService } from './attendance-directory.service';
import { AttendanceDirectoryController } from './attendance-directory.controller';

/**
 * Camera-attendance integration (Phase 0 — foundations).
 *
 *  - AttendanceClient            : read-only HTTP client for Summit Attendance Cloud
 *  - AttendanceController        : admin connectivity probe (GET /attendance/ping)
 *  - AttendanceDirectory*        : outbound employee feed the camera polls
 *                                  (GET /integrations/attendance/employees)
 *
 * Later phases add the daily-attendance mirror, sync cron, and monthly payroll.
 */
@Module({
  controllers: [AttendanceController, AttendanceDirectoryController],
  providers: [AttendanceClient, AttendanceDirectoryService],
  exports: [AttendanceClient],
})
export class AttendanceModule {}
