import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClient } from './attendance.client';
import { AttendanceDaily, AttendanceEvent } from './attendance.contracts';
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

  /** Resolve a single date / from-to range / default-today into a date list. */
  private resolveRange(dto: SyncAttendanceDto): { from: string; to: string; dates: string[] } {
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
    return { from, to, dates };
  }

  /**
   * Work-start 09:00 PKT + 20-min grace → PRESENT/LATE plus minutes-late, from a
   * check-in instant. Used by the events bridge (the /daily rollup computes this
   * itself, but the bridge bypasses it). Matches the camera's policy on file.
   */
  private statusFromCheckIn(checkIn: Date): { status: AttendanceStatus; lateMin: number } {
    const pkt = new Date(checkIn.getTime() + 5 * 3600 * 1000);
    const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
    const workStart = 9 * 60; // 09:00 PKT
    const grace = 20;
    const lateMin = Math.max(0, minutes - workStart);
    return { status: lateMin > grace ? AttendanceStatus.LATE : AttendanceStatus.PRESENT, lateMin };
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
    const { from, to, dates } = this.resolveRange(dto);

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

        // Ingest the camera's computed minutes so the payroll rules engine has
        // real inputs (it never re-derives break/late from raw punches).
        const computed = {
          grossPresenceMin: Math.max(0, Math.round(r.gross_presence_min ?? 0)),
          breakMin: Math.max(0, Math.round(r.lunch_min ?? 0)),
          personalMin: Math.max(0, Math.round(r.personal_min ?? 0)),
          personalOverMin: Math.max(0, Math.round(r.personal_over_min ?? 0)),
          unscheduledExits: Math.max(0, Math.round(r.unscheduled_exits ?? 0)),
          overtimeMin: Math.max(0, Math.round(r.overtime_min ?? 0)),
          lateMin: Math.max(0, Math.round(r.late_min ?? 0)),
        };

        await this.prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: empId, date: this.dateOnly(date) } },
          create: { employeeId: empId, date: this.dateOnly(date), checkInAt: checkIn, checkOutAt: checkOut, status, notes, isOverride: false, ...computed },
          update: { checkInAt: checkIn, checkOutAt: checkOut, status, notes, isOverride: false, ...computed },
        });
        imported++;
      }
    }
    this.log.log(`sync ${from}..${to}: imported=${imported} skipped=${skipped} unmatched=${unmatched}`);
    return { from, to, days: dates.length, imported, skipped, unmatched };
  }

  // ── events bridge (raw detections → CRM) ─────────────────────────────────────

  /**
   * Build attendance from the camera's RAW detection events instead of its
   * computed /daily. The camera's daily rollup discards low-confidence face
   * matches (~0.4–0.6 on the sub-stream), marking everyone absent even though
   * people were clearly seen. This bridge reads /events directly, accepts
   * sightings down to a configurable similarity floor (default 0 = accept all,
   * provisional), and records first-seen → check-in, last-seen → check-out.
   *
   * Honest by design: people NOT seen are left as "no data" (we don't assert
   * ABSENT off a possibly-missed detection), and manual overrides are never
   * clobbered. Tune the floor with ATTENDANCE_EVENTS_MIN_SIMILARITY.
   */
  async syncFromEvents(dto: SyncAttendanceDto, actorUserId: string) {
    void actorUserId; // reserved for future audit; parity with sync()
    if (!this.client.configured) {
      throw new BadRequestException('Attendance API is not configured.');
    }
    const { from, to, dates } = this.resolveRange(dto);

    const parsedFloor = parseFloat(process.env.ATTENDANCE_EVENTS_MIN_SIMILARITY ?? '0');
    const minSim = Number.isFinite(parsedFloor) ? parsedFloor : 0;

    const ours = await this.prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true } });
    const ourIds = new Set(ours.map((e) => e.id));

    let imported = 0;
    let skipped = 0;
    let seen = 0;
    for (const date of dates) {
      let events: AttendanceEvent[];
      try {
        events = await this.client.getEvents(date);
      } catch (e) {
        this.log.warn(`events-sync ${date} failed: ${(e as Error).message}`);
        continue;
      }

      // Group this date's events per employee → first/last sighting.
      const byEmp = new Map<string, { first: Date; last: Date; count: number; maxSim: number }>();
      for (const ev of events || []) {
        const empId = String(ev.emp_code);
        if (!ourIds.has(empId)) continue; // numeric/test codes — not one of ours
        if (typeof ev.similarity === 'number' && ev.similarity < minSim) continue;
        const t = new Date(ev.ts);
        if (isNaN(t.getTime())) continue;
        // The feed can bleed across days at a high limit — keep PKT-`date` only.
        if (new Date(t.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10) !== date) continue;
        const sim = typeof ev.similarity === 'number' ? ev.similarity : 0;
        const a = byEmp.get(empId);
        if (!a) {
          byEmp.set(empId, { first: t, last: t, count: 1, maxSim: sim });
        } else {
          if (t < a.first) a.first = t;
          if (t > a.last) a.last = t;
          a.count++;
          if (sim > a.maxSim) a.maxSim = sim;
        }
      }

      for (const [empId, a] of byEmp) {
        seen++;
        const existing = await this.prisma.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId: empId, date: this.dateOnly(date) } },
          select: { isOverride: true },
        });
        if (existing?.isOverride) { skipped++; continue; } // never clobber a manual fix

        const checkIn = a.first;
        const checkOut = a.last.getTime() > a.first.getTime() ? a.last : null;
        const { status, lateMin } = this.statusFromCheckIn(checkIn);
        const grossPresenceMin = checkOut
          ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000))
          : 0;
        const notes = `From camera detections (${a.count} sighting${a.count === 1 ? '' : 's'}, confidence ${Math.round(a.maxSim * 100)}%)`;

        await this.prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: empId, date: this.dateOnly(date) } },
          create: { employeeId: empId, date: this.dateOnly(date), checkInAt: checkIn, checkOutAt: checkOut, status, notes, isOverride: false, lateMin, grossPresenceMin },
          update: { checkInAt: checkIn, checkOutAt: checkOut, status, notes, isOverride: false, lateMin, grossPresenceMin },
        });
        imported++;
      }
    }
    this.log.log(`events-sync ${from}..${to}: seen=${seen} imported=${imported} skipped=${skipped} minSim=${minSim}`);
    return { from, to, days: dates.length, imported, skipped, seen, source: 'events' as const };
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
