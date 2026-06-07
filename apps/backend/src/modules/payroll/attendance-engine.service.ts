import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AttendanceReviewStatus,
  AttendanceStatus,
  AuditAction,
  ExceptionStatus,
  LeaveStatus,
  OfficialDutyStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PayrollConfigService } from './payroll-config.service';
import {
  AdjustDayDto,
  CreateLeaveDto,
  CreateOfficialDutyDto,
  RecomputeDto,
  ReviewDutyDto,
  ReviewExceptionDto,
  ReviewLeaveDto,
} from './payroll.dto';
import { computeDay, eachYmd, hhmmToMin, RawDay, RulesPolicy } from './attendance-rules';

/**
 * The "approved layer" engine: recomputes computed attendance from raw + policy
 * (never touching approved/locked data), surfaces exceptions, and applies admin
 * approvals / adjustments / official duty / leave. Payroll reads what this
 * produces, never the raw camera fields directly.
 */
@Injectable()
export class AttendanceEngineService {
  private readonly log = new Logger('AttendanceEngine');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PayrollConfigService,
    private readonly audit: AuditLogService,
  ) {}

  private dateOnly(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
  }
  private ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  private toRulesPolicy(p: Awaited<ReturnType<PayrollConfigService['getPolicy']>>): RulesPolicy {
    return {
      workStart: p.workStart, workEnd: p.workEnd, graceMin: p.graceMin, allowedBreakMin: p.allowedBreakMin,
      fullDayMinMin: p.fullDayMinMin, halfDayMinMin: p.halfDayMinMin, workingDays: p.workingDays,
      saturdayPolicy: p.saturdayPolicy, overtimeStartAfter: p.overtimeStartAfter,
      overtimeMinBlockMin: p.overtimeMinBlockMin, roundingMin: p.roundingMin,
    };
  }

  // ── Recompute (raw → computed), idempotent + approval/lock-safe ──
  async recompute(dto: RecomputeDto, _actorUserId: string) {
    const from = dto.date ?? dto.from;
    const to = dto.date ?? dto.to;
    if (!from || !to) throw new BadRequestException('Provide date, or from + to.');
    const policy = this.toRulesPolicy(await this.config.getPolicy());
    const dates = eachYmd(this.dateOnly(from), this.dateOnly(to));
    if (!dates.length) throw new BadRequestException('Invalid range.');

    const employees = await this.prisma.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
    const holidays = await this.config.holidayMap(this.dateOnly(from), this.dateOnly(to));

    let processed = 0, needsReview = 0, locked = 0;
    for (const ymd of dates) {
      const dateObj = this.dateOnly(ymd);
      const weekday = dateObj.getUTCDay();
      const isHoliday = holidays.has(ymd);
      for (const emp of employees) {
        const r = await this.recomputeOne(emp.id, ymd, dateObj, weekday, isHoliday, policy);
        if (r === 'locked') locked++;
        else { processed++; if (r === 'needs_review') needsReview++; }
      }
    }
    return { from, to, employees: employees.length, processed, needsReview, locked };
  }

  /** Recompute a single (employee, date). Returns 'locked' | 'needs_review' | 'ok'. */
  private async recomputeOne(
    employeeId: string, ymd: string, dateObj: Date, weekday: number, isHoliday: boolean, policy: RulesPolicy,
  ): Promise<'locked' | 'needs_review' | 'ok'> {
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: dateObj } },
    });
    if (existing?.reviewStatus === AttendanceReviewStatus.LOCKED) return 'locked';

    // Approved overlay inputs (never wiped by recompute).
    const dutyAgg = await this.prisma.officialDutySlip.aggregate({
      where: { employeeId, date: dateObj, status: OfficialDutyStatus.APPROVED },
      _sum: { minutes: true },
    });
    const officialDutyMin = dutyAgg._sum.minutes ?? 0;
    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: { employeeId, status: LeaveStatus.APPROVED, fromDate: { lte: dateObj }, toDate: { gte: dateObj } },
      select: { paid: true },
    });
    const approvedExtraBreakMin = existing?.approvedExtraBreakMin ?? 0;

    const raw: RawDay = {
      firstIn: existing?.checkInAt ? this.pktHHMM(existing.checkInAt) : null,
      lastOut: existing?.checkOutAt ? this.pktHHMM(existing.checkOutAt) : null,
      grossPresenceMin: existing?.grossPresenceMin ?? 0,
      breakMin: existing?.breakMin ?? 0,
      personalMin: existing?.personalMin ?? 0,
      personalOverMin: existing?.personalOverMin ?? 0,
      unscheduledExits: existing?.unscheduledExits ?? 0,
      lateMin: existing?.lateMin ?? 0,
      overtimeMin: existing?.overtimeMin ?? 0,
    };
    const computed = computeDay(raw, { weekday, isHoliday, isOnApprovedLeave: !!onLeave, officialDutyMin, approvedExtraBreakMin }, policy);

    // A manual override keeps its admin-set status; otherwise use the computed one.
    const keepManualStatus = existing?.isOverride === true;
    const reviewStatus =
      existing?.reviewStatus === AttendanceReviewStatus.APPROVED
        ? AttendanceReviewStatus.APPROVED
        : computed.exceptions.length > 0
          ? AttendanceReviewStatus.NEEDS_REVIEW
          : AttendanceReviewStatus.COMPUTED;

    await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: dateObj } },
      create: {
        employeeId, date: dateObj, status: computed.status, dayType: computed.dayType,
        lateMin: computed.lateMin, earlyLeaveMin: computed.earlyLeaveMin, overtimeMin: computed.overtimeMin,
        personalOverMin: computed.personalOverMin, officialDutyMin, netPayableMin: computed.netPayableMin,
        reviewStatus, source: 'CAMERA',
      },
      update: {
        ...(keepManualStatus ? {} : { status: computed.status }),
        dayType: computed.dayType, lateMin: computed.lateMin, earlyLeaveMin: computed.earlyLeaveMin,
        overtimeMin: computed.overtimeMin, personalOverMin: computed.personalOverMin, officialDutyMin,
        netPayableMin: computed.netPayableMin, reviewStatus,
      },
    });

    // Upsert exceptions: refresh computed fields, NEVER overwrite a reviewed one.
    const computedTypes = new Set(computed.exceptions.map((e) => e.type));
    for (const ex of computed.exceptions) {
      const prev = await this.prisma.attendanceException.findUnique({
        where: { employeeId_date_type: { employeeId, date: dateObj, type: ex.type } },
      });
      if (prev && prev.status !== ExceptionStatus.PENDING) continue; // reviewed → leave it
      await this.prisma.attendanceException.upsert({
        where: { employeeId_date_type: { employeeId, date: dateObj, type: ex.type } },
        create: { employeeId, date: dateObj, type: ex.type, minutes: ex.minutes, description: ex.description },
        update: { minutes: ex.minutes, description: ex.description },
      });
    }
    // Drop PENDING exceptions that no longer apply (stale).
    await this.prisma.attendanceException.deleteMany({
      where: { employeeId, date: dateObj, status: ExceptionStatus.PENDING, type: { notIn: [...computedTypes] } },
    });

    return reviewStatus === AttendanceReviewStatus.NEEDS_REVIEW ? 'needs_review' : 'ok';
  }

  private pktHHMM(d: Date): string {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  }

  // ── Daily review board ──
  async listDaily(ymd: string) {
    const dateObj = this.dateOnly(ymd);
    const emps = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
      orderBy: [{ firstName: 'asc' }],
    });
    const ids = emps.map((e) => e.id);
    const recs = await this.prisma.attendanceRecord.findMany({ where: { date: dateObj, employeeId: { in: ids } } });
    const exs = await this.prisma.attendanceException.findMany({ where: { date: dateObj, employeeId: { in: ids } } });
    const recByEmp = new Map(recs.map((r) => [r.employeeId, r]));
    const exByEmp = new Map<string, typeof exs>();
    for (const e of exs) { const a = exByEmp.get(e.employeeId) ?? []; a.push(e); exByEmp.set(e.employeeId, a); }
    return {
      date: ymd,
      rows: emps.map((e) => ({
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        email: e.user?.email ?? null,
        record: recByEmp.get(e.id) ?? null,
        exceptions: exByEmp.get(e.id) ?? [],
      })),
    };
  }

  async approveDay(employeeId: string, ymd: string, actorUserId: string) {
    const dateObj = this.dateOnly(ymd);
    const rec = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: dateObj } } });
    if (!rec) throw new NotFoundException('No attendance record for that day.');
    if (rec.reviewStatus === AttendanceReviewStatus.LOCKED) throw new BadRequestException('Day is locked by payroll.');
    const updated = await this.prisma.attendanceRecord.update({
      where: { employeeId_date: { employeeId, date: dateObj } },
      data: { reviewStatus: AttendanceReviewStatus.APPROVED, approvedByUserId: actorUserId, approvedAt: new Date() },
    });
    await this.audit.log({ actorUserId, action: AuditAction.ATTENDANCE_APPROVED, entityType: 'AttendanceRecord', entityId: rec.id, newValues: { employeeId, date: ymd } as any });
    return updated;
  }

  async bulkApproveClean(ymd: string, actorUserId: string) {
    const dateObj = this.dateOnly(ymd);
    // Days with NO pending exceptions and not locked/approved yet.
    const pendingEmp = new Set(
      (await this.prisma.attendanceException.findMany({ where: { date: dateObj, status: ExceptionStatus.PENDING }, select: { employeeId: true } })).map((e) => e.employeeId),
    );
    const recs = await this.prisma.attendanceRecord.findMany({
      where: { date: dateObj, reviewStatus: { in: [AttendanceReviewStatus.COMPUTED, AttendanceReviewStatus.NEEDS_REVIEW] } },
      select: { id: true, employeeId: true },
    });
    const toApprove = recs.filter((r) => !pendingEmp.has(r.employeeId)).map((r) => r.id);
    if (toApprove.length) {
      await this.prisma.attendanceRecord.updateMany({
        where: { id: { in: toApprove } },
        data: { reviewStatus: AttendanceReviewStatus.APPROVED, approvedByUserId: actorUserId, approvedAt: new Date() },
      });
    }
    return { approved: toApprove.length };
  }

  // ── Review a typed exception ──
  async reviewException(id: string, dto: ReviewExceptionDto, actorUserId: string) {
    const ex = await this.prisma.attendanceException.findUnique({ where: { id } });
    if (!ex) throw new NotFoundException('Exception not found');
    const status = dto.status === 'APPROVED' ? ExceptionStatus.APPROVED : ExceptionStatus.REJECTED;
    await this.prisma.attendanceException.update({
      where: { id },
      data: { status, overtimeResolution: dto.overtimeResolution ?? null, remark: dto.remark ?? null, reviewedByUserId: actorUserId, reviewedAt: new Date() },
    });
    // Approving an extra-break credits it back so the day isn't penalised.
    if (status === ExceptionStatus.APPROVED && ex.type === 'EXTRA_BREAK') {
      const rec = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: ex.employeeId, date: ex.date } } });
      if (rec) {
        await this.prisma.attendanceRecord.update({
          where: { id: rec.id },
          data: { approvedExtraBreakMin: rec.approvedExtraBreakMin + ex.minutes },
        });
      }
    }
    await this.audit.log({ actorUserId, action: ex.type === 'OVERTIME' ? AuditAction.OVERTIME_REVIEWED : AuditAction.ATTENDANCE_EXCEPTION_REVIEWED, entityType: 'AttendanceException', entityId: id, oldValues: { status: ex.status } as any, newValues: { status, overtimeResolution: dto.overtimeResolution } as any });
    // Recompute the single day so net payable + status reflect the approval.
    const policy = this.toRulesPolicy(await this.config.getPolicy());
    const holidays = await this.config.holidayMap(ex.date, ex.date);
    await this.recomputeOne(ex.employeeId, this.ymd(ex.date), ex.date, ex.date.getUTCDay(), holidays.has(this.ymd(ex.date)), policy);
    return { success: true as const };
  }

  // ── Manual day adjustment (audited) ──
  async adjustDay(dto: AdjustDayDto, actorUserId: string) {
    const dateObj = this.dateOnly(dto.date);
    const before = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: dto.employeeId, date: dateObj } } });
    if (before?.reviewStatus === AttendanceReviewStatus.LOCKED) throw new BadRequestException('Day is locked by payroll.');
    const data: Prisma.AttendanceRecordUncheckedUpdateInput = { isOverride: true, overriddenByUserId: actorUserId };
    if (dto.officialDutyMin != null) data.officialDutyMin = dto.officialDutyMin;
    if (dto.approvedExtraBreakMin != null) data.approvedExtraBreakMin = dto.approvedExtraBreakMin;
    if (dto.status) data.status = dto.status as AttendanceStatus;
    if (dto.notes != null) data.notes = dto.notes;

    const after = await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date: dateObj } },
      create: { employeeId: dto.employeeId, date: dateObj, source: 'MANUAL', isOverride: true, overriddenByUserId: actorUserId, status: (dto.status as AttendanceStatus) ?? AttendanceStatus.PRESENT, officialDutyMin: dto.officialDutyMin ?? 0, approvedExtraBreakMin: dto.approvedExtraBreakMin ?? 0, notes: dto.notes ?? null },
      update: data,
    });
    await this.prisma.attendanceAdjustment.create({
      data: { employeeId: dto.employeeId, date: dateObj, action: 'MANUAL_ADJUST', oldValue: (before ?? null) as unknown as any, newValue: after as unknown as any, reason: dto.reason, actorUserId },
    });
    await this.audit.log({ actorUserId, action: AuditAction.ATTENDANCE_ADJUSTED, entityType: 'AttendanceRecord', entityId: after.id, oldValues: (before ?? {}) as unknown as any, newValues: { ...dto } as any });
    return after;
  }

  async listAdjustments(employeeId: string, ymd: string) {
    return this.prisma.attendanceAdjustment.findMany({ where: { employeeId, date: this.dateOnly(ymd) }, orderBy: { createdAt: 'desc' } });
  }

  // ── Official duty ──
  private dutyMinutes(fromTime: string, toTime: string): number {
    const a = hhmmToMin(fromTime), b = hhmmToMin(toTime);
    return a != null && b != null && b > a ? b - a : 0;
  }

  async createDuty(dto: CreateOfficialDutyDto, actorUserId: string) {
    const minutes = this.dutyMinutes(dto.fromTime, dto.toTime);
    if (minutes <= 0) throw new BadRequestException('toTime must be after fromTime.');
    return this.prisma.officialDutySlip.create({
      data: {
        employeeId: dto.employeeId, date: this.dateOnly(dto.date), fromTime: dto.fromTime, toTime: dto.toTime,
        minutes, reason: dto.reason, location: dto.location ?? null, attachmentKey: dto.attachmentKey ?? null,
        createdByUserId: actorUserId,
      },
    });
  }

  async listDuty(status?: OfficialDutyStatus, employeeId?: string) {
    return this.prisma.officialDutySlip.findMany({
      where: { ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) },
      orderBy: { date: 'desc' }, take: 500,
    });
  }

  async reviewDuty(id: string, dto: ReviewDutyDto, actorUserId: string) {
    const duty = await this.prisma.officialDutySlip.findUnique({ where: { id } });
    if (!duty) throw new NotFoundException('Duty slip not found');
    const updated = await this.prisma.officialDutySlip.update({
      where: { id },
      data: { status: dto.status, remarks: dto.remarks ?? null, approvedByUserId: actorUserId, approvedAt: dto.status === OfficialDutyStatus.APPROVED ? new Date() : null },
    });
    await this.audit.log({ actorUserId, action: AuditAction.OFFICIAL_DUTY_REVIEWED, entityType: 'OfficialDutySlip', entityId: id, newValues: { status: dto.status } as any });
    // Recompute that day so approved duty credits into payable time.
    const policy = this.toRulesPolicy(await this.config.getPolicy());
    const holidays = await this.config.holidayMap(duty.date, duty.date);
    await this.recomputeOne(duty.employeeId, this.ymd(duty.date), duty.date, duty.date.getUTCDay(), holidays.has(this.ymd(duty.date)), policy);
    return updated;
  }

  // ── Leave ──
  async createLeave(dto: CreateLeaveDto, actorUserId: string) {
    const from = this.dateOnly(dto.fromDate), to = this.dateOnly(dto.toDate);
    if (to < from) throw new BadRequestException('toDate must be on/after fromDate.');
    const days = dto.days ?? Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    return this.prisma.leaveRequest.create({
      data: { employeeId: dto.employeeId, kind: dto.kind, fromDate: from, toDate: to, days, paid: dto.kind !== 'UNPAID', reason: dto.reason ?? null, createdByUserId: actorUserId },
    });
  }

  async listLeave(status?: LeaveStatus, employeeId?: string) {
    return this.prisma.leaveRequest.findMany({
      where: { ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) },
      orderBy: { fromDate: 'desc' }, take: 500,
    });
  }

  async reviewLeave(id: string, dto: ReviewLeaveDto, actorUserId: string) {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    const updated = await this.prisma.leaveRequest.update({
      where: { id }, data: { status: dto.status, remarks: dto.remarks ?? null, reviewedByUserId: actorUserId, reviewedAt: new Date() },
    });
    await this.audit.log({ actorUserId, action: AuditAction.LEAVE_REVIEWED, entityType: 'LeaveRequest', entityId: id, newValues: { status: dto.status } as any });
    if (dto.status === LeaveStatus.APPROVED) {
      const policy = this.toRulesPolicy(await this.config.getPolicy());
      const holidays = await this.config.holidayMap(leave.fromDate, leave.toDate);
      for (const ymd of eachYmd(leave.fromDate, leave.toDate)) {
        const d = this.dateOnly(ymd);
        await this.recomputeOne(leave.employeeId, ymd, d, d.getUTCDay(), holidays.has(ymd), policy);
      }
    }
    return updated;
  }

  async leaveBalances(employeeId: string, year: number) {
    const policy = await this.config.getPolicy();
    const start = new Date(`${year}-01-01T00:00:00.000Z`), end = new Date(`${year}-12-31T00:00:00.000Z`);
    const approved = await this.prisma.leaveRequest.findMany({
      where: { employeeId, status: LeaveStatus.APPROVED, fromDate: { gte: start, lte: end } },
      select: { kind: true, days: true },
    });
    const used = { ANNUAL: 0, SICK: 0, CASUAL: 0, UNPAID: 0 } as Record<string, number>;
    for (const l of approved) used[l.kind] += l.days;
    return {
      year,
      annual: { quota: policy.annualLeaveQuota, used: used.ANNUAL, remaining: policy.annualLeaveQuota - used.ANNUAL },
      sick: { quota: policy.sickLeaveQuota, used: used.SICK, remaining: policy.sickLeaveQuota - used.SICK },
      casual: { quota: policy.casualLeaveQuota, used: used.CASUAL, remaining: policy.casualLeaveQuota - used.CASUAL },
      unpaid: { used: used.UNPAID },
    };
  }
}
