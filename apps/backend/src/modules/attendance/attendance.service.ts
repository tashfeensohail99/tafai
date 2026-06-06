import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClient } from './attendance.client';
import { AttendanceDaily } from './attendance.contracts';
import { MarkAttendanceDto, SyncAttendanceDto } from './attendance.dto';

const PKT_OFFSET = '+05:00'; // Asia/Karachi, no DST
const MAX_RANGE_DAYS = 92;

/**
 * Attendance — pulls the camera cloud's computed daily attendance and stores it
 * in core.attendance_records, exposes it for viewing, and supports manual
 * marking/override. The camera echoes our Employee.id as its emp_code, so we
 * link rows 1:1 by id (rows whose emp_code isn't one of ours — the camera's own
 * test entries — are skipped). Manual overrides are never clobbered by a sync.
 */
@Injectable()
export class AttendanceService {
  private readonly log = new Logger('Attendance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AttendanceClient,
  ) {}

  // ── helpers ───────────────────────────────────────────────────────────────

  /** A @db.Date value for a 'YYYY-MM-DD' string (UTC midnight → date only). */
  private dateOnly(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
  }

  /** Combine 'YYYY-MM-DD' + 'HH:MM' (Asia/Karachi) into a timestamp, or null. */
  private toPkt(ymd: string, hhmm: string | null | undefined): Date | null {
    if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
    const t = hhmm.length === 4 ? `0${hhmm}` : hhmm.slice(0, 5);
    const d = new Date(`${ymd}T${t}:00${PKT_OFFSET}`);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Today's date in Asia/Karachi as 'YYYY-MM-DD'. */
  private todayPkt(): string {
    return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  }

  private eachDate(from: string, to: string): string[] {
    const start = this.dateOnly(from);
    const end = this.dateOnly(to);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
    const out: string[] = [];
    for (let d = new Date(start), i = 0; d <= end && i < MAX_RANGE_DAYS; d.setUTCDate(d.getUTCDate() + 1), i++) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  /** Camera status string → our enum. null = not a trackable day (weekend/holiday/off). */
  private mapStatus(camStatus: string, lateMin: number): AttendanceStatus | null {
    const s = String(camStatus || '').toLowerCase();
    if (s.includes('absent')) return AttendanceStatus.ABSENT;
    if (s.includes('leave')) return AttendanceStatus.ON_LEAVE;
    if (s.includes('half')) return AttendanceStatus.HALF_DAY;
    if (s.includes('late')) return AttendanceStatus.LATE;
    if (s.includes('present')) return lateMin > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
    return null; // weekend / holiday / off / unknown
  }

  private buildNotes(r: AttendanceDaily): string | null {
    const p: string[] = [];
    if (r.late_min > 0) p.push(`late ${r.late_min}m`);
    if (r.overtime_min > 0) p.push(`OT ${r.overtime_min}m`);
    const flags = Array.isArray(r.flags) ? r.flags : r.flags ? [String(r.flags)] : [];
    if (flags.length) p.push(flags.filter(Boolean).join(','));
    return p.length ? p.join('; ') : null;
  }

  // ── sync (camera → CRM) ─────────────────────────────────────────────────────

  async sync(dto: SyncAttendanceDto, actorUserId: string) {
    if (!this.client.configured) {
      throw new BadRequestException('Attendance API is not configured.');
    }
    let from: string, to: string;
    if (dto.date) {
      from = to = dto.date;
    } else if (dto.from && dto.to) {
      from = dto.from;
      to = dto.to;
    } else {
      from = to = this.todayPkt();
    }
    const dates = this.eachDate(from, to);
    if (dates.length === 0) throw new BadRequestException('Invalid date range.');

    // Which emp_codes map to our employees (camera echoes our Employee.id).
    const ours = await this.prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true } });
    const ourIds = new Set(ours.map((e) => e.id));

    let imported = 0;
    let skipped = 0;
    let unmatched = 0;
    for (const date of dates) {
      let rows: AttendanceDaily[];
      try {
        rows = await this.client.getDaily(date);
      } catch (e) {
        this.log.warn(`sync ${date} failed: ${(e as Error).message}`);
        continue;
      }
      for (const r of rows || []) {
        const empId = String(r.emp_code);
        if (!ourIds.has(empId)) { unmatched++; continue; } // camera's own / test rows
        const checkIn = this.toPkt(date, r.first_in);
        const checkOut = this.toPkt(date, r.last_out);
        const mapped = this.mapStatus(r.status, r.late_min ?? 0);
        if (!mapped && !checkIn) { skipped++; continue; } // weekend / no activity → don't store
        const status = mapped ?? AttendanceStatus.PRESENT;
        const notes = this.buildNotes(r);

        // Never clobber a manual override.
        const existing = await this.prisma.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId: empId, date: this.dateOnly(date) } },
          select: { isOverride: true },
        });
        if (existing?.isOverride) { skipped++; continue; }

        await this.prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: empId, date: this.dateOnly(date) } },
          create: { employeeId: empId, date: this.dateOnly(date), checkInAt: checkIn, checkOutAt: checkOut, status, notes, isOverride: false },
          update: { checkInAt: checkIn, checkOutAt: checkOut, status, notes, isOverride: false },
        });
        imported++;
      }
    }
    this.log.log(`sync ${from}..${to}: imported=${imported} skipped=${skipped} unmatched=${unmatched}`);
    return { from, to, days: dates.length, imported, skipped, unmatched };
  }

  // ── read ────────────────────────────────────────────────────────────────────

  /** Daily board: every active employee + their record for `date` (null = no data). */
  async listDaily(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const emps = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const recs = await this.prisma.attendanceRecord.findMany({
      where: { date: this.dateOnly(date), employeeId: { in: emps.map((e) => e.id) } },
    });
    const byEmp = new Map(recs.map((r) => [r.employeeId, r]));
    return {
      date,
      rows: emps.map((e) => {
        const r = byEmp.get(e.id) ?? null;
        return {
          employeeId: e.id,
          name: `${e.firstName} ${e.lastName}`.trim(),
          email: e.user?.email ?? null,
          code: e.employeeCode ?? null,
          status: r?.status ?? null,
          checkInAt: r?.checkInAt ?? null,
          checkOutAt: r?.checkOutAt ?? null,
          notes: r?.notes ?? null,
          isOverride: r?.isOverride ?? false,
        };
      }),
    };
  }

  /** One employee's records across a date range (most recent first). */
  async listByEmployee(employeeId: string, from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    }
    const records = await this.prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: this.dateOnly(from), lte: this.dateOnly(to) } },
      orderBy: { date: 'desc' },
    });
    return { employeeId, from, to, records };
  }

  // ── manual mark / override ────────────────────────────────────────────────────

  async mark(dto: MarkAttendanceDto, actorUserId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new BadRequestException('Employee not found.');

    const data: Prisma.AttendanceRecordUncheckedCreateInput = {
      employeeId: dto.employeeId,
      date: this.dateOnly(dto.date),
      status: dto.status,
      checkInAt: this.toPkt(dto.date, dto.checkIn),
      checkOutAt: this.toPkt(dto.date, dto.checkOut),
      notes: dto.notes?.trim() || null,
      isOverride: true,
      overriddenByUserId: actorUserId,
    };
    const rec = await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date: this.dateOnly(dto.date) } },
      create: data,
      update: {
        status: data.status,
        checkInAt: data.checkInAt,
        checkOutAt: data.checkOutAt,
        notes: data.notes,
        isOverride: true,
        overriddenByUserId: actorUserId,
      },
    });
    this.log.log(`attendance ${dto.employeeId} ${dto.date} marked ${dto.status} by ${actorUserId}`);
    return rec;
  }
}
