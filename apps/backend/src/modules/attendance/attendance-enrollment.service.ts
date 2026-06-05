import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmployeesService } from '../employees/employees.service';
import { ApproveEnrollmentDto, SubmitEnrollmentDto } from './attendance-enrollment.dto';

/**
 * Camera-initiated employee enrollment, gated behind admin approval.
 *
 *   camera → submit()  -> PENDING request (or DUPLICATE if we already have them)
 *   admin  → approve() -> creates a real User + Employee, links the request
 *   admin  → reject()  -> closes the request
 *
 * The camera NEVER creates an employee directly; a human (admin) always confirms.
 * The whole feature is gated by Organization.attendanceEnrollmentEnabled.
 */
@Injectable()
export class AttendanceEnrollmentService {
  private readonly log = new Logger('AttendanceEnrollment');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly employees: EmployeesService,
  ) {}

  private async isEnabled(): Promise<boolean> {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { attendanceEnrollmentEnabled: true },
    });
    return !!org?.attendanceEnrollmentEnabled;
  }

  private splitName(dto: SubmitEnrollmentDto): { firstName: string; lastName: string } {
    let firstName = (dto.firstName ?? '').trim();
    let lastName = (dto.lastName ?? '').trim();
    if (!firstName && dto.fullName) {
      const parts = dto.fullName.trim().split(/\s+/).filter(Boolean);
      firstName = parts.shift() ?? '';
      lastName = parts.join(' ');
    }
    return { firstName, lastName };
  }

  // ── Camera (machine-to-machine, X-API-Key) ────────────────────────────────

  async submit(dto: SubmitEnrollmentDto) {
    if (!(await this.isEnabled())) {
      // Documented contract: 403 with a machine-readable code.
      throw new ForbiddenException({
        error: 'enrollment_disabled',
        message: 'Camera enrollment is currently disabled by the administrator.',
      });
    }

    const { firstName, lastName } = this.splitName(dto);
    if (!firstName) {
      throw new BadRequestException('A name is required (fullName or firstName).');
    }
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone?.trim() || null;
    const cnic = dto.cnic?.trim() || null;
    if (!email && !phone) {
      throw new BadRequestException('A phone or email is required.');
    }

    // Dedup vs existing employees (the directory the camera already polls).
    const matchOr = [
      ...(email ? [{ user: { email } }] : []),
      ...(phone ? [{ user: { phone } }] : []),
      ...(cnic ? [{ nationalId: cnic }] : []),
    ];
    const existing = matchOr.length
      ? await this.prisma.employee.findFirst({
          where: { deletedAt: null, OR: matchOr },
          select: { id: true },
        })
      : null;

    if (existing) {
      const dup = await this.prisma.attendanceEnrollmentRequest.create({
        data: {
          status: 'DUPLICATE',
          firstName,
          lastName,
          email,
          phone,
          cnic,
          department: dto.department ?? null,
          cameraEmpCode: dto.cameraEmpCode ?? null,
          note: dto.note ?? null,
          joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : null,
          matchedEmployeeId: existing.id,
        },
        select: { id: true },
      });
      return { requestId: dup.id, status: 'DUPLICATE' as const, existingId: existing.id };
    }

    // Idempotency: an existing PENDING request for the same phone/email is reused
    // (Meta-style retries / a double-tap by the operator won't create duplicates).
    const pending =
      email || phone
        ? await this.prisma.attendanceEnrollmentRequest.findFirst({
            where: {
              status: 'PENDING',
              OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])],
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        : null;
    if (pending) return { requestId: pending.id, status: 'PENDING' as const };

    const req = await this.prisma.attendanceEnrollmentRequest.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        cnic,
        department: dto.department ?? null,
        cameraEmpCode: dto.cameraEmpCode ?? null,
        note: dto.note ?? null,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : null,
      },
      select: { id: true },
    });
    this.log.log(`enrollment request ${req.id} queued (camera)`);
    return { requestId: req.id, status: 'PENDING' as const };
  }

  async getStatus(requestId: string) {
    const r = await this.prisma.attendanceEnrollmentRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        employeeId: true,
        matchedEmployeeId: true,
        rejectionReason: true,
      },
    });
    if (!r) throw new NotFoundException('Enrollment request not found');
    return {
      requestId: r.id,
      status: r.status,
      employeeId: r.employeeId ?? r.matchedEmployeeId ?? null,
      reason: r.rejectionReason ?? null,
    };
  }

  // ── Admin (JWT) ───────────────────────────────────────────────────────────

  async list(status?: string) {
    return this.prisma.attendanceEnrollmentRequest.findMany({
      where: status ? { status: status as never } : {},
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
  }

  async getSettings() {
    return { enabled: await this.isEnabled() };
  }

  async setEnabled(enabled: boolean) {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    await this.prisma.organization.update({
      where: { id: org.id },
      data: { attendanceEnrollmentEnabled: enabled },
    });
    return { enabled };
  }

  async approve(id: string, dto: ApproveEnrollmentDto, actorUserId: string) {
    const req = await this.prisma.attendanceEnrollmentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Enrollment request not found');
    if (req.status === 'APPROVED' && req.employeeId) {
      return { employeeId: req.employeeId, status: 'APPROVED' as const };
    }
    if (req.status === 'REJECTED') {
      throw new BadRequestException('This request was rejected.');
    }

    const firstName = (dto.firstName?.trim() || req.firstName).trim();
    const lastName = (dto.lastName?.trim() || req.lastName || '').trim();
    const email = dto.email.trim().toLowerCase();

    // 1) Login account — random temp password, must-change-on-first-login (set by
    //    UsersService). Phone is intentionally NOT copied to the account to avoid
    //    a unique-phone collision blocking approval; add later if needed.
    const tempPassword = `Ta${randomBytes(12).toString('base64url')}!9`;
    const user = await this.users.create(
      { email, password: tempPassword, roleNames: [dto.roleName] },
      actorUserId,
    );

    // 2) Employee profile linked to the account.
    const emp = await this.employees.create(
      {
        userId: user.id,
        firstName,
        lastName,
        departmentId: dto.departmentId,
        nationalId: req.cnic ?? undefined,
        joiningDate: req.joiningDate ? req.joiningDate.toISOString().slice(0, 10) : undefined,
        tempPasswordForEmail: tempPassword,
      },
      actorUserId,
    );

    // 3) Resolve the request → the camera's status poll now returns this id.
    await this.prisma.attendanceEnrollmentRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        employeeId: emp.id,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });
    this.log.log(`enrollment request ${id} approved -> employee ${emp.id}`);
    return { employeeId: emp.id, status: 'APPROVED' as const };
  }

  async reject(id: string, reason: string | undefined, actorUserId: string) {
    const req = await this.prisma.attendanceEnrollmentRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!req) throw new NotFoundException('Enrollment request not found');
    await this.prisma.attendanceEnrollmentRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason ?? null,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });
    return { status: 'REJECTED' as const };
  }
}
