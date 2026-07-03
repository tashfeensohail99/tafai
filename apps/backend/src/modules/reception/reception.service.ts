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

  // ── Today's register ─────────────────────────────────────────────────────
  async listVisits(query: ListVisitsQueryDto) {
    const { start, end, dayStr } = this.pktDayRange(query.date);
    const where: Prisma.VisitWhereInput = {
      checkedInAt: { gte: start, lt: end },
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { visitType: query.type } : {}),
    };
    const visits = await this.prisma.visit.findMany({
      where,
      orderBy: { checkedInAt: 'desc' },
      // A single physical front desk won't exceed this in one day; the KPI counts
      // below are derived from this page, so the cap doubles as their ceiling.
      take: 1000,
    });

    // Resolve the scalar cross-refs (reference codes + host names) in batch —
    // these are point-in-time links, not Prisma relations, so we join by hand.
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

    const counts = {
      total: rows.length,
      waiting: rows.filter((r) => r.status === 'WAITING').length,
      inMeeting: rows.filter((r) => r.status === 'IN_MEETING').length,
      done: rows.filter((r) => r.status === 'DONE').length,
      walkIn: rows.filter((r) => r.visitType === 'WALK_IN').length,
      existing: rows.filter((r) => r.visitType === 'EXISTING_CLIENT').length,
      paid: rows.filter((r) => r.visitType === 'PAID_CONSULT').length,
    };
    return { date: dayStr, counts, visits: rows };
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

  private pktDayRange(dateStr?: string): { start: Date; end: Date; dayStr: string } {
    const day = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : this.todayPkt();
    const start = new Date(`${day}T00:00:00.000+05:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, dayStr: day };
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
