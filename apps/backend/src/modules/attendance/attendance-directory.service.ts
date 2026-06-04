import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DirectoryEmployee } from './attendance.contracts';

/**
 * Builds the outbound employee directory the camera-attendance system polls.
 *
 * `id` (our Employee.id) is the stable key the camera stores as its emp_code and
 * echoes back in attendance data — so the two systems link with zero name/email
 * matching. We expose only non-sensitive identity fields (never salary/payroll).
 * Soft-deleted employees are excluded; inactive ones are included with
 * `active:false` so the camera can mirror status.
 */
@Injectable()
export class AttendanceDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(): Promise<DirectoryEmployee[]> {
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        isActive: true,
        user: { select: { email: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return employees.map((e) => ({
      id: e.id,
      code: e.employeeCode ?? null,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.user?.email ?? null,
      active: e.isActive,
    }));
  }
}
