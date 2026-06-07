import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AttendanceReviewStatus,
  AttendanceStatus,
  AuditAction,
  ExceptionStatus,
  LeaveStatus,
  PayrollPeriodStatus,
  Prisma,
  SalaryBasis,
  SaturdayPolicy,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PayrollConfigService } from './payroll-config.service';
import { eachYmd } from './attendance-rules';

const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const APPROVED: AttendanceReviewStatus[] = [AttendanceReviewStatus.APPROVED, AttendanceReviewStatus.LOCKED];

/**
 * Payroll generation + locking. Reads ONLY the approved attendance layer +
 * approved leave + compensation history — never raw camera fields. A locked
 * period stamps its days immutable so payslips never change silently.
 */
@Injectable()
export class PayrollRunService {
  private readonly log = new Logger('PayrollRun');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PayrollConfigService,
    private readonly audit: AuditLogService,
  ) {}

  private ymd(d: Date) { return d.toISOString().slice(0, 10); }

  async listPeriods() {
    const org = await this.config.getOrg();
    return this.prisma.payrollPeriod.findMany({ where: { orgId: org.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  private async getOrCreatePeriod(year: number, month: number) {
    const org = await this.config.getOrg();
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0)); // last day of month
    return this.prisma.payrollPeriod.upsert({
      where: { orgId_year_month: { orgId: org.id, year, month } },
      create: { orgId: org.id, year, month, startDate, endDate },
      update: {},
    });
  }

  /** Generate (preview) payslips for every active employee. Period stays DRAFT. */
  async generate(year: number, month: number, actorUserId: string) {
    const period = await this.getOrCreatePeriod(year, month);
    if (period.status === PayrollPeriodStatus.LOCKED) throw new BadRequestException('Period is locked. Unlock to regenerate.');

    const policy = await this.config.getPolicy();
    const holidays = await this.config.holidayMap(period.startDate, period.endDate);
    const dates = eachYmd(period.startDate, period.endDate);
    const isWorkingDay = (weekday: number, ymd: string) =>
      !holidays.has(ymd) && (policy.workingDays.includes(weekday) || (weekday === 6 && policy.saturdayPolicy === SaturdayPolicy.WORKING));
    const workingDays = dates.filter((ymd) => isWorkingDay(new Date(`${ymd}T00:00:00Z`).getUTCDay(), ymd)).length;

    const employees = await this.prisma.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });

    let generated = 0, unapprovedTotal = 0;
    for (const emp of employees) {
      const comp = await this.config.resolveComp(emp.id, period.endDate);
      const basic = comp ? D(comp.basicSalary) : D(0);
      const allowances = comp ? D(comp.allowances) : D(0);
      const dailyRate = policy.salaryBasis === SalaryBasis.WORKING_DAYS && workingDays > 0
        ? basic.div(workingDays)
        : basic.div(30);

      const recs = await this.prisma.attendanceRecord.findMany({
        where: { employeeId: emp.id, date: { gte: period.startDate, lte: period.endDate } },
      });
      const recByYmd = new Map(recs.map((r) => [this.ymd(r.date), r]));
      const leaves = await this.prisma.leaveRequest.findMany({
        where: { employeeId: emp.id, status: LeaveStatus.APPROVED, fromDate: { lte: period.endDate }, toDate: { gte: period.startDate } },
      });
      const leaveOn = (ymd: string) => leaves.find((l) => this.ymd(l.fromDate) <= ymd && this.ymd(l.toDate) >= ymd);

      // Approved overtime (paid) minutes for the period.
      const otMin = (
        await this.prisma.attendanceException.aggregate({
          where: { employeeId: emp.id, type: 'OVERTIME', overtimeResolution: 'APPROVED_PAID', date: { gte: period.startDate, lte: period.endDate } },
          _sum: { minutes: true },
        })
      )._sum.minutes ?? 0;

      let present = 0, half = 0, absent = 0, paidLeave = 0, unpaidLeave = 0, holidayCount = 0, unapproved = 0;
      for (const ymd of dates) {
        const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
        if (holidays.has(ymd)) { holidayCount++; continue; }
        if (!isWorkingDay(weekday, ymd)) continue; // weekly off / optional Saturday — neutral
        const rec = recByYmd.get(ymd);
        const lv = leaveOn(ymd);
        if (rec && APPROVED.includes(rec.reviewStatus)) {
          switch (rec.status) {
            case AttendanceStatus.PRESENT:
            case AttendanceStatus.LATE:
            case AttendanceStatus.OFFICIAL_DUTY: present++; break;
            case AttendanceStatus.HALF_DAY: half++; break;
            case AttendanceStatus.ON_LEAVE: lv && !lv.paid ? unpaidLeave++ : paidLeave++; break;
            default: absent++; break;
          }
        } else if (lv) {
          lv.paid ? paidLeave++ : unpaidLeave++;
        } else {
          // working day with no approved record → unapproved; treated as absent in preview
          absent++; unapproved++;
        }
      }
      unapprovedTotal += unapproved;

      const halfDeductionDays = D(half).mul(D('0.5'));
      const absenceDeduction = dailyRate.mul(D(absent).add(halfDeductionDays)).toDecimalPlaces(2);
      const unpaidLeaveDeduction = dailyRate.mul(D(unpaidLeave)).toDecimalPlaces(2);
      const hourlyRate = dailyRate.div(8);
      const overtimePay = policy.overtimeRequiresApproval ? hourlyRate.mul(D(otMin).div(60)).toDecimalPlaces(2) : D(0);
      const grossPay = basic.add(allowances).add(overtimePay).toDecimalPlaces(2);
      const totalDeductions = absenceDeduction.add(unpaidLeaveDeduction).toDecimalPlaces(2);
      const netPayable = grossPay.sub(totalDeductions).toDecimalPlaces(2);

      const breakdown = {
        earnings: [
          { label: 'Basic salary', amount: basic.toFixed(2) },
          { label: 'Allowances', amount: allowances.toFixed(2) },
          ...(overtimePay.gt(0) ? [{ label: `Approved overtime (${otMin} min)`, amount: overtimePay.toFixed(2) }] : []),
        ],
        deductions: [
          ...(absenceDeduction.gt(0) ? [{ label: `Absence (${absent} + ${half}×½ days)`, amount: absenceDeduction.toFixed(2) }] : []),
          ...(unpaidLeaveDeduction.gt(0) ? [{ label: `Unpaid leave (${unpaidLeave} days)`, amount: unpaidLeaveDeduction.toFixed(2) }] : []),
        ],
        days: { workingDays, present, half, absent, paidLeave, unpaidLeave, holidays: holidayCount, unapproved },
      };

      await this.prisma.payslip.upsert({
        where: { payrollPeriodId_employeeId: { payrollPeriodId: period.id, employeeId: emp.id } },
        create: {
          payrollPeriodId: period.id, employeeId: emp.id, basicSalary: basic, allowances, dailyRate: dailyRate.toDecimalPlaces(2),
          workingDays, presentDays: D(present), absentDays: D(absent).add(halfDeductionDays), halfDays: half,
          paidLeaveDays: D(paidLeave), unpaidLeaveDays: D(unpaidLeave), holidays: holidayCount,
          absenceDeduction, unpaidLeaveDeduction, overtimePay, grossPay, totalDeductions, netPayable,
          policySnapshot: policy as unknown as any, breakdown: breakdown as unknown as any,
        },
        update: {
          basicSalary: basic, allowances, dailyRate: dailyRate.toDecimalPlaces(2), workingDays,
          presentDays: D(present), absentDays: D(absent).add(halfDeductionDays), halfDays: half,
          paidLeaveDays: D(paidLeave), unpaidLeaveDays: D(unpaidLeave), holidays: holidayCount,
          absenceDeduction, unpaidLeaveDeduction, overtimePay, grossPay, totalDeductions, netPayable,
          policySnapshot: policy as unknown as any, breakdown: breakdown as unknown as any,
        },
      });
      generated++;
    }

    await this.prisma.payrollPeriod.update({ where: { id: period.id }, data: { generatedAt: new Date(), createdByUserId: period.createdByUserId ?? actorUserId } });
    await this.audit.log({ actorUserId, action: AuditAction.PAYROLL_GENERATED, entityType: 'PayrollPeriod', entityId: period.id, newValues: { year, month, generated, unapprovedTotal } as any });
    return { periodId: period.id, year, month, employees: employees.length, generated, workingDays, unapprovedDays: unapprovedTotal };
  }

  async listPayslips(periodId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException('Period not found');
    const slips = await this.prisma.payslip.findMany({ where: { payrollPeriodId: periodId } });
    // attach names
    const emps = await this.prisma.employee.findMany({
      where: { id: { in: slips.map((s) => s.employeeId) } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } },
    });
    const byId = new Map(emps.map((e) => [e.id, e]));
    return {
      period,
      payslips: slips
        .map((s) => ({ ...s, employee: byId.get(s.employeeId) ? { name: `${byId.get(s.employeeId)!.firstName} ${byId.get(s.employeeId)!.lastName}`.trim(), email: byId.get(s.employeeId)!.user?.email ?? null, code: byId.get(s.employeeId)!.employeeCode ?? null } : null }))
        .sort((a, b) => (a.employee?.name ?? '').localeCompare(b.employee?.name ?? '')),
    };
  }

  /** Lock a generated period: stamp every day in range immutable. */
  async lock(periodId: string, actorUserId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException('Period not found');
    if (period.status === PayrollPeriodStatus.LOCKED) return period;
    if (!period.generatedAt) throw new BadRequestException('Generate the payroll before locking.');
    await this.prisma.$transaction([
      this.prisma.payrollPeriod.update({ where: { id: periodId }, data: { status: PayrollPeriodStatus.LOCKED, lockedByUserId: actorUserId, lockedAt: new Date() } }),
      this.prisma.attendanceRecord.updateMany({
        where: { date: { gte: period.startDate, lte: period.endDate } },
        data: { reviewStatus: AttendanceReviewStatus.LOCKED, lockedPayrollPeriodId: periodId },
      }),
    ]);
    await this.audit.log({ actorUserId, action: AuditAction.PAYROLL_PERIOD_LOCKED, entityType: 'PayrollPeriod', entityId: periodId, newValues: { year: period.year, month: period.month } as any });
    return this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  }

  /** Unlock (privileged, audited): release the days so corrections can be made. */
  async unlock(periodId: string, actorUserId: string) {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException('Period not found');
    await this.prisma.$transaction([
      this.prisma.payrollPeriod.update({ where: { id: periodId }, data: { status: PayrollPeriodStatus.DRAFT, lockedByUserId: null, lockedAt: null } }),
      this.prisma.attendanceRecord.updateMany({
        where: { lockedPayrollPeriodId: periodId },
        data: { reviewStatus: AttendanceReviewStatus.APPROVED, lockedPayrollPeriodId: null },
      }),
    ]);
    await this.audit.log({ actorUserId, action: AuditAction.PAYROLL_PERIOD_UNLOCKED, entityType: 'PayrollPeriod', entityId: periodId, newValues: { year: period.year, month: period.month } as any });
    return this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  }
}
