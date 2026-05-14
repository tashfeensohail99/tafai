import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '@prisma/client';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employees.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly email: EmailService,
  ) {}

  async findAll() {
    return this.prisma.employee.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        user: { select: { email: true, phone: true, status: true } },
        department: { select: { name: true } },
        branch: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findById(id: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id, deletedAt: null },
      include: {
        user: {
          select: {
            email: true,
            phone: true,
            status: true,
            userRoles: {
              include: { role: { select: { name: true, displayName: true } } },
            },
          },
        },
        department: true,
        branch: true,
        designation: true,
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async create(dto: CreateEmployeeDto, actorUserId: string) {
    const userExists = await this.prisma.userAccount.findUnique({
      where: { id: dto.userId },
    });
    if (!userExists) throw new NotFoundException('User account not found');

    const alreadyEmployee = await this.prisma.employee.findUnique({
      where: { userId: dto.userId },
    });
    if (alreadyEmployee) throw new ConflictException('User already has an employee profile');

    const emp = await this.prisma.employee.create({
      data: {
        userId: dto.userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        departmentId: dto.departmentId,
        branchId: dto.branchId,
        designationId: dto.designationId,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        nationalId: dto.nationalId,
        passportNumber: dto.passportNumber,
        nationality: dto.nationality,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_CREATED,
      entityType: 'Employee',
      entityId: emp.id,
      newValues: { userId: dto.userId, firstName: dto.firstName, lastName: dto.lastName },
    });

    // Welcome email — fire-and-forget, non-blocking
    void (async () => {
      try {
        const user = await this.prisma.userAccount.findUnique({
          where: { id: dto.userId },
          select: { email: true },
        });
        if (user?.email) {
          await this.email.sendWelcomeEmployee({
            to: user.email,
            firstName: dto.firstName,
            tempPassword: dto.tempPasswordForEmail ?? '(ask your administrator)',
            loginUrl: 'https://tashfeengroup.com/login',
          });
        }
      } catch {
        // Never let email failure break employee creation
      }
    })();

    return emp;
  }

  async update(id: string, dto: UpdateEmployeeDto, actorUserId: string) {
    const emp = await this.findById(id);

    const updated = await this.prisma.employee.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: 'Employee',
      entityId: id,
      oldValues: {
        firstName: emp.firstName,
        lastName: emp.lastName,
        departmentId: emp.departmentId,
      },
      newValues: dto,
    });

    return updated;
  }
}
