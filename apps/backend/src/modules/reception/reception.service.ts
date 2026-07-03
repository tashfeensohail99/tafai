import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VisitStatus, VisitType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';
import {
  CreateVisitDto,
  ListVisitsQueryDto,
  LookupQueryDto,
  UpdateVisitDto,
} from './reception.dto';

type LookupHit = {
  kind: 'lead' | 'client';
  id: string;
  name: string;
  phone: string | null;
  referenceCode: string;
  status: string;
  owner: string | null;
};

/** Split a free-text name into first / last for the Lead we create. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? full.trim();
  const lastName = parts.slice(1).join(' ');
  return { firstName: firstName || 'Guest', lastName };
}

@Injectable()
export class ReceptionService {
  private readonly log = new Logger(ReceptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly assignment: LeadAssignmentService,
  ) {}

  // ── Lookup — is this visitor already in the CRM? ─────────────────────────
  async lookup(query: LookupQueryDto): Promise<{ results: LookupHit[] }> {
    const term = query.q.trim();
    const [leads, clients] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          OR: [
            { phone: { contains: term } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          referenceCode: true,
          status: true,
          assignedEmployee: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.findMany({
        where: {
          deletedAt: null,
          OR: [
            { phone: { contains: term } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          referenceCode: true,
          status: true,
          assignedEmployee: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    // Converted clients first — they're the more authoritative record.
    const results: LookupHit[] = [
      ...clients.map((c) => ({
        kind: 'client' as const,
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        phone: c.phone,
        referenceCode: c.referenceCode,
        status: c.status,
        owner: c.assignedEmployee
          ? `${c.assignedEmployee.firstName} ${c.assignedEmployee.lastName}`.trim()
          : null,
      })),
      ...leads.map((l) => ({
        kind: 'lead' as const,
        id: l.id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        phone: l.phone,
        referenceCode: l.referenceCode,
        status: l.status,
        owner: l.assignedEmployee
          ? `${l.assignedEmployee.firstName} ${l.assignedEmployee.lastName}`.trim()
          : null,
      })),
    ];
    return { results };
  }

  // ── Active staff, for the "who are they here to see?" host picker ─────────
  async getHosts(): Promise<{ hosts: Array<{ id: string; name: string; department: string | null }> }> {
    const emps = await this.prisma.employee.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } },
    });
    return {
      hosts: emps.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        department: e.department?.name ?? null,
      })),
    };
  }

  // ── Visit register — today's board (default) or a searchable, paginated log ─
  async listVisits(query: ListVisitsQueryDto) {
    const { start, end, label } = this.resolveRange(query);
    const q = query.q?.trim();
    // The date-range + search window. The status/type breakdown counts are taken
    // over THIS (not the status/type-filtered set) so the summary always reflects
    // the whole window even when the user narrows by a status or type.
    const baseWhere: Prisma.VisitWhereInput = {
      checkedInAt: { gte: start, lt: end },
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
    };
    const where: Prisma.VisitWhereInput = {
      ...baseWhere,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { visitType: query.type } : {}),
    };

    const limit = clampInt(query.limit, 50, 1, 200);
    const offset = clampInt(query.offset, 0, 0, 1_000_000);

    // Counts come from the DB over the whole window (count/groupBy), not the
    // paginated page, so KPIs + the breakdown stay accurate regardless of paging.
    const [total, statusGroups, typeGroups, visits] = await Promise.all([
      this.prisma.visit.count({ where }),
      this.prisma.visit.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
      this.prisma.visit.groupBy({ by: ['visitType'], where: baseWhere, _count: { _all: true } }),
      this.prisma.visit.findMany({ where, orderBy: { checkedInAt: 'desc' }, take: limit, skip: offset }),
    ]);
    const sc = (s: VisitStatus) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
    const tc = (t: VisitType) => typeGroups.find((g) => g.visitType === t)?._count._all ?? 0;
    const counts = {
      total,
      waiting: sc(VisitStatus.WAITING),
      inMeeting: sc(VisitStatus.IN_MEETING),
      done: sc(VisitStatus.DONE),
      noShow: sc(VisitStatus.NO_SHOW),
      cancelled: sc(VisitStatus.CANCELLED),
      walkIn: tc(VisitType.WALK_IN),
      existing: tc(VisitType.EXISTING_CLIENT),
      paid: tc(VisitType.PAID_CONSULT),
    };

    // Resolve the scalar cross-refs (reference codes + host names) for the page
    // in batch — these are point-in-time links, not Prisma relations.
    const leadIds = uniq(visits.map((v) => v.leadId));
    const clientIds = uniq(visits.map((v) => v.clientId));
    const empIds = uniq(visits.map((v) => v.hostEmployeeId));

    const [leadRows, clientRows, empRows] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, referenceCode: true } })
        : Promise.resolve([]),
      clientIds.length
        ? this.prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, referenceCode: true } })
        : Promise.resolve([]),
      empIds.length
        ? this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([]),
    ]);
    const leadRef = new Map(leadRows.map((r) => [r.id, r.referenceCode]));
    const clientRef = new Map(clientRows.map((r) => [r.id, r.referenceCode]));
    const empName = new Map(empRows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));

    const rows = visits.map((v) => ({
      id: v.id,
      visitType: v.visitType,
      status: v.status,
      name: v.name,
      phone: v.phone,
      purpose: v.purpose,
      notes: v.notes,
      leadId: v.leadId,
      clientId: v.clientId,
      hostEmployeeId: v.hostEmployeeId,
      referenceCode:
        (v.clientId ? clientRef.get(v.clientId) : undefined) ??
        (v.leadId ? leadRef.get(v.leadId) : undefined) ??
        null,
      hostName: v.hostEmployeeId ? empName.get(v.hostEmployeeId) ?? null : null,
      checkedInAt: v.checkedInAt.toISOString(),
      checkedOutAt: v.checkedOutAt ? v.checkedOutAt.toISOString() : null,
    }));

    return { label, total, limit, offset, counts, visits: rows };
  }

  // ── Check a visitor in ───────────────────────────────────────────────────
  async createVisit(dto: CreateVisitDto, actorUserId: string) {
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || null;
    let leadId = dto.leadId ?? null;
    let clientId = dto.clientId ?? null;

    // A walk-in with no linked record ALWAYS becomes a Lead (business rule), so
    // it needs a phone number to key that Lead on.
    if (dto.visitType === VisitType.WALK_IN && !leadId && !clientId && !phone) {
      throw new BadRequestException('A walk-in needs a phone number so we can create their lead.');
    }

    // No link supplied: try to match an existing record by phone (avoid a
    // duplicate lead); otherwise, for a walk-in, create a fresh Lead through
    // the shared round-robin so Sales owns the follow-up.
    if (!leadId && !clientId) {
      const matched = phone ? await this.matchByPhone(phone) : null;
      if (matched) {
        if (matched.kind === 'client') clientId = matched.id;
        else leadId = matched.id;
      } else if (dto.visitType === VisitType.WALK_IN) {
        leadId = await this.createWalkInLead(name, phone, dto.purpose ?? null, actorUserId);
      }
    }

    // Validate any linked ids actually exist (and aren't soft-deleted).
    if (leadId) {
      const exists = await this.prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true } });
      if (!exists) throw new NotFoundException('Linked lead not found');
    }
    if (clientId) {
      const exists = await this.prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true } });
      if (!exists) throw new NotFoundException('Linked client not found');
    }
    if (dto.hostEmployeeId) {
      const emp = await this.prisma.employee.findFirst({ where: { id: dto.hostEmployeeId, deletedAt: null }, select: { id: true } });
      if (!emp) throw new NotFoundException('Host employee not found');
    }

    return this.prisma.visit.create({
      data: {
        visitType: dto.visitType,
        name,
        phone,
        leadId,
        clientId,
        hostEmployeeId: dto.hostEmployeeId ?? null,
        purpose: dto.purpose ?? null,
        notes: dto.notes ?? null,
        checkedInByUserId: actorUserId,
      },
    });
  }

  // ── Check out / change status / reassign host ────────────────────────────
  async updateVisit(id: string, dto: UpdateVisitDto) {
    const visit = await this.prisma.visit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Visit not found');

    const data: Prisma.VisitUpdateInput = {};
    if (dto.status) {
      data.status = dto.status;
      const terminal: VisitStatus[] = [VisitStatus.DONE, VisitStatus.NO_SHOW, VisitStatus.CANCELLED];
      if (terminal.includes(dto.status)) {
        // Any terminal state checks the visitor out (stamp the time once).
        if (!visit.checkedOutAt) data.checkedOutAt = new Date();
      } else if (visit.checkedOutAt) {
        // Re-opened back to WAITING / IN_MEETING — drop the stale checkout stamp.
        data.checkedOutAt = null;
      }
    }
    if (dto.hostEmployeeId !== undefined) {
      if (dto.hostEmployeeId) {
        const emp = await this.prisma.employee.findFirst({ where: { id: dto.hostEmployeeId, deletedAt: null }, select: { id: true } });
        if (!emp) throw new NotFoundException('Host employee not found');
      }
      data.hostEmployeeId = dto.hostEmployeeId || null;
    }
    if (dto.notes !== undefined) data.notes = dto.notes || null;

    return this.prisma.visit.update({ where: { id }, data });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private async matchByPhone(phone: string): Promise<{ kind: 'lead' | 'client'; id: string } | null> {
    const client = await this.prisma.client.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (client) return { kind: 'client', id: client.id };
    const lead = await this.prisma.lead.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (lead) return { kind: 'lead', id: lead.id };
    return null;
  }

  private async createWalkInLead(
    name: string,
    phone: string | null,
    purpose: string | null,
    actorUserId: string,
  ): Promise<string | null> {
    if (!phone) return null; // guarded earlier for walk-ins; belt-and-braces
    const { firstName, lastName } = splitName(name);
    // Round-robin to a sales rep (shared cursor, same pool as CSV / Meta leads).
    const pickedAgentId = await this.assignment.pickNextAgent();
    try {
      const lead = await this.leads.create(
        {
          firstName,
          lastName,
          phone,
          sourceChannel: 'walk-in',
          ...(pickedAgentId ? { assignedEmployeeId: pickedAgentId } : {}),
          ...(purpose ? { notes: `Walk-in: ${purpose}` } : {}),
        },
        actorUserId,
      );
      // When the round-robin pool is empty, leads.create falls back to assigning
      // the lead to the ACTOR (the receptionist) via `dto.assignedEmployeeId ??
      // actor`. A walk-in must never be owned by the front desk — leave it
      // unassigned for a later assignment to pick up, exactly like an empty-pool
      // CSV / Meta lead. (Passing assignedEmployeeId:null wouldn't help — `??`
      // treats null and undefined alike — so we correct it after the create.)
      if (!pickedAgentId && lead.assignedEmployeeId) {
        await this.prisma.lead.update({ where: { id: lead.id }, data: { assignedEmployeeId: null } });
      }
      return lead.id;
    } catch (err) {
      // The only recoverable failure is a raced duplicate phone (a concurrent
      // create beat us and ensureUniqueLead threw) — link the now-existing lead.
      // Any other error means NO lead was persisted, so rethrow rather than
      // silently logging a walk-in with no lead (the "always a lead" rule).
      const existing = await this.prisma.lead.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
      if (existing) {
        this.log.warn(`walk-in lead create raced a duplicate; linked existing ${existing.id}`);
        return existing.id;
      }
      throw err;
    }
  }

  // Resolve the query window in Pakistan time. A from+to pair gives an
  // inclusive day range (for the visitor log); otherwise a single day (default
  // today, for the live board).
  private resolveRange(query: ListVisitsQueryDto): { start: Date; end: Date; label: string } {
    const dayStart = (d: string) => new Date(`${d}T00:00:00.000+05:00`);
    const plusDay = (dt: Date) => new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    // Well-shaped AND a real calendar day — rejects e.g. 2026-13-45, which would
    // otherwise build an Invalid Date and crash the Prisma query with a 500.
    const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayStart(s).getTime());
    if (valid(query.from) && valid(query.to)) {
      // Normalise a reversed range so a from > to pair still returns that window.
      const [a, b] = query.from! <= query.to! ? [query.from!, query.to!] : [query.to!, query.from!];
      return { start: dayStart(a), end: plusDay(dayStart(b)), label: `${a} → ${b}` };
    }
    const day = valid(query.date) ? query.date! : this.todayPkt();
    const start = dayStart(day);
    return { start, end: plusDay(start), label: day };
  }

  private todayPkt(): string {
    const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const y = pkt.getUTCFullYear();
    const m = String(pkt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(pkt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/** Distinct, non-null ids from a scalar-ref column. */
function uniq(ids: Array<string | null>): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))];
}

/** Parse a string query param to a bounded integer, falling back to a default. */
function clampInt(v: string | undefined, dflt: number, min: number, max: number): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
