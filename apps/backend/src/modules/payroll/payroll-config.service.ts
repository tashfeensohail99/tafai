import { Injectable, NotFoundException } from '@nestjs/common';
import { AttendancePolicy, AuditAction, Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SetCompensationDto, UpdatePolicyDto, UpsertHolidayDto } from './payroll.dto';

/** Policy, holiday calendar, and compensation history — the configurable layer. */
@Injectable()
export class PayrollConfigService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  private dateOnly(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
  }

  async getOrg(): Promise<Organization> {
    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new NotFoundException('No organization configured');
    return org;
  }

  /** The active policy, creating a default row the first time. */
  async getPolicy(): Promise<AttendancePolicy> {
    const org = await this.getOrg();
    let policy = await this.prisma.attendancePolicy.findFirst({
      where: { orgId: org.id, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!policy) policy = await this.prisma.attendancePolicy.create({ data: { orgId: org.id } });
    return policy;
  }

  async updatePolicy(dto: UpdatePolicyDto, actorUserId: string): Promise<AttendancePolicy> {
    const current = await this.getPolicy();
    const updated = await this.prisma.attendancePolicy.update({
      where: { id: current.id },
      data: { ...dto, version: current.version + 1, updatedByUserId: actorUserId },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.ATTENDANCE_POLICY_UPDATED,
      entityType: 'AttendancePolicy',
      entityId: current.id,
      oldValues: current as unknown as any,
      newValues: dto as unknown as any,
    });
    return updated;
  }

  // ── Holidays ──
  async listHolidays(year?: number) {
    const org = await this.getOrg();
    const where: Prisma.HolidayWhereInput = { orgId: org.id };
    if (year) {
      where.date = { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T00:00:00.000Z`) };
    }
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  async upsertHoliday(dto: UpsertHolidayDto, actorUserId: string) {
    const org = await this.getOrg();
    const date = this.dateOnly(dto.date);
    const row = await this.prisma.holiday.upsert({
      where: { orgId_date: { orgId: org.id, date } },
      create: { orgId: org.id, date, name: dto.name, type: dto.type ?? 'COMPANY', createdByUserId: actorUserId },
      update: { name: dto.name, type: dto.type ?? 'COMPANY' },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.HOLIDAY_UPSERTED,
      entityType: 'Holiday',
      entityId: row.id,
      newValues: { date: dto.date, name: dto.name, type: dto.type } as any,
    });
    return row;
  }

  async deleteHoliday(id: string) {
    await this.prisma.holiday.delete({ where: { id } }).catch(() => undefined);
    return { success: true as const };
  }

  /** Map of 'YYYY-MM-DD' → holiday name, for the org. */
  async holidayMap(from: Date, to: Date): Promise<Map<string, string>> {
    const org = await this.getOrg();
    const rows = await this.prisma.holiday.findMany({ where: { orgId: org.id, date: { gte: from, lte: to } } });
    return new Map(rows.map((h) => [h.date.toISOString().slice(0, 10), h.name]));
  }

  // ── Compensation ──
  async listCompensation(employeeId: string) {
    return this.prisma.employeeCompensation.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async setCompensation(dto: SetCompensationDto, actorUserId: string) {
    const row = await this.prisma.employeeCompensation.create({
      data: {
        employeeId: dto.employeeId,
        basicSalary: new Prisma.Decimal(dto.basicSalary),
        allowances: new Prisma.Decimal(dto.allowances ?? 0),
        effectiveFrom: this.dateOnly(dto.effectiveFrom),
        remarks: dto.remarks ?? null,
        createdByUserId: actorUserId,
      },
    });
    await this.audit.log({
      actorUserId,
      action: AuditAction.COMPENSATION_UPDATED,
      entityType: 'EmployeeCompensation',
      entityId: row.id,
      newValues: { employeeId: dto.employeeId, basicSalary: dto.basicSalary, effectiveFrom: dto.effectiveFrom } as any,
    });
    return row;
  }

  /** Active compensation on a given date = latest effectiveFrom <= date. */
  async resolveComp(employeeId: string, onDate: Date) {
    return this.prisma.employeeCompensation.findFirst({
      where: { employeeId, isActive: true, effectiveFrom: { lte: onDate } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
