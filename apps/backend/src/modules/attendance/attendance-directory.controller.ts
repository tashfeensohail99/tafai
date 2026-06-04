import { Controller, Get, UseGuards } from '@nestjs/common';
import { AttendanceApiKeyGuard } from './attendance-api-key.guard';
import { AttendanceDirectoryService } from './attendance-directory.service';
import { DirectoryEmployee } from './attendance.contracts';

/**
 * Outbound, machine-to-machine feed consumed by the camera-attendance system.
 *
 * GET /integrations/attendance/employees
 *   Auth: shared key (X-API-Key or Authorization: Bearer) — NOT a user JWT.
 *   Returns the current employee roster. The camera polls this and stores each
 *   `id` as its emp_code, so attendance flows back already linked to our staff.
 *
 * Read-only and identity-only (no salary/payroll fields are ever exposed here).
 */
@Controller('integrations/attendance')
@UseGuards(AttendanceApiKeyGuard)
export class AttendanceDirectoryController {
  constructor(private readonly directory: AttendanceDirectoryService) {}

  @Get('employees')
  async employees(): Promise<{ employees: DirectoryEmployee[]; count: number }> {
    const employees = await this.directory.listEmployees();
    return { employees, count: employees.length };
  }
}
