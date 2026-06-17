import { Module } from '@nestjs/common';
import { AttendanceClient } from './attendance.client';
import { AttendanceService } from './attendance.service';
import { AttendanceSyncSweeperService } from './attendance-sync-sweeper.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceDirectoryService } from './attendance-directory.service';
import { AttendanceDirectoryController } from './attendance-directory.controller';
import { AttendanceEnrollmentService } from './attendance-enrollment.service';
import { AttendanceEnrollmentController } from './attendance-enrollment.controller';
import { AttendanceEnrollmentAdminController } from './attendance-enrollment-admin.controller';
import { UsersModule } from '../users/users.module';
import { EmployeesModule } from '../employees/employees.module';

/**
 * Camera-attendance integration.
 *
 *  - AttendanceClient            : read-only HTTP client for Summit Attendance Cloud
 *  - AttendanceController        : admin connectivity probe (GET /attendance/ping)
 *  - AttendanceDirectory*        : outbound employee feed the camera polls
 *                                  (GET /integrations/attendance/employees)
 *  - AttendanceEnrollment*       : camera-initiated walk-in enrollment as an
 *                                  admin-approved request (request -> approve ->
 *                                  creates User+Employee). Reuses Users/Employees
 *                                  services; gated by an org master on/off switch.
 */
@Module({
  imports: [UsersModule, EmployeesModule],
  controllers: [
    AttendanceController,
    AttendanceDirectoryController,
    AttendanceEnrollmentController,
    AttendanceEnrollmentAdminController,
  ],
  providers: [
    AttendanceClient,
    AttendanceService,
    AttendanceSyncSweeperService,
    AttendanceDirectoryService,
    AttendanceEnrollmentService,
  ],
  exports: [AttendanceClient],
})
export class AttendanceModule {}
