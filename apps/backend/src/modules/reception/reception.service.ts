import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, Prisma, VisitStatus, VisitType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';
import { FinanceService } from '../finance/finance.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsAppAppointmentNotifierService } from '../whatsapp/notifications/appointment-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CollectConsultationDto,
  CreateVisitDto,
  ListVisitsQueryDto,
  LookupQueryDto,
  ReceptionReportQueryDto,
  UpdateReceptionSettingsDto,
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

/** Well-shaped YYYY-MM-DD AND a real calendar day (rejects e.g. 2026-13-45,
 *  which would otherwise build an Invalid Date and crash the query with a 500). */
function isRealDay(s?: string): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00.000+05:00`).getTime());
}

@Injectable()
export class ReceptionService {
  private readonly log = new Logger(ReceptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly assignment: LeadAssignmentService,
    private readonly finance: FinanceService,
    private readonly appointments: AppointmentsService,
    private readonly whatsappNotifier: WhatsAppAppointmentNotifierService,
    private readonly notifications: NotificationsService,
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

    const apptIds = uniq(visits.map((v) => v.appointmentId));

    const [leadRows, clientRows, empRows, apptRows] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, referenceCode: true } })
        : Promise.resolve([]),
      clientIds.length
        ? this.prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, referenceCode: true } })
        : Promise.resolve([]),
      empIds.length
        ? this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([]),
      apptIds.length
        ? this.prisma.appointment.findMany({ where: { id: { in: apptIds } }, select: { id: true, scheduledAt: true } })
        : Promise.resolve([]),
    ]);
    const leadRef = new Map(leadRows.map((r) => [r.id, r.referenceCode]));
    const clientRef = new Map(clientRows.map((r) => [r.id, r.referenceCode]));
    const empName = new Map(empRows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));
    const apptAt = new Map(apptRows.map((r) => [r.id, r.scheduledAt.toISOString()]));

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
      // Paid consultation (phase 2).
      paid: !!v.paymentId,
      feeAmount: v.feeAmount != null ? Number(v.feeAmount) : null,
      feeCurrency: v.feeCurrency,
      appointmentAt: v.appointmentId ? apptAt.get(v.appointmentId) ?? null : null,
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

  // ── Consultation settings (principal, fee, receiving bank) ────────────────
  async getSettings() {
    const org = await this.orgRow();
    let principal: { id: string; name: string } | null = null;
    if (org?.principalEmployeeId) {
      const e = await this.prisma.employee.findFirst({
        where: { id: org.principalEmployeeId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      });
      if (e) principal = { id: e.id, name: `${e.firstName} ${e.lastName}`.trim() };
    }
    const feeAmount = org?.consultationFeeAmount != null ? Number(org.consultationFeeAmount) : null;
    return {
      principal,
      feeAmount,
      feeCurrency: org?.consultationFeeCurrency ?? null,
      bank: {
        iban: org?.consultationBankIban ?? null,
        name: org?.consultationBankName ?? null,
        title: org?.consultationBankTitle ?? null,
      },
      configured: !!(org?.principalEmployeeId && feeAmount && feeAmount > 0 && org?.consultationFeeCurrency),
    };
  }

  async updateSettings(dto: UpdateReceptionSettingsDto) {
    const org = await this.orgRow();
    if (!org) throw new NotFoundException('Organization not configured');
    if (dto.principalEmployeeId) {
      const e = await this.prisma.employee.findFirst({ where: { id: dto.principalEmployeeId, deletedAt: null }, select: { id: true } });
      if (!e) throw new BadRequestException('Selected principal employee not found');
    }
    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        ...(dto.principalEmployeeId !== undefined ? { principalEmployeeId: dto.principalEmployeeId || null } : {}),
        ...(dto.feeAmount !== undefined ? { consultationFeeAmount: dto.feeAmount ? new Prisma.Decimal(dto.feeAmount) : null } : {}),
        ...(dto.feeCurrency !== undefined ? { consultationFeeCurrency: dto.feeCurrency?.trim().toUpperCase() || null } : {}),
        ...(dto.bankIban !== undefined ? { consultationBankIban: dto.bankIban?.trim() || null } : {}),
        ...(dto.bankName !== undefined ? { consultationBankName: dto.bankName?.trim() || null } : {}),
        ...(dto.bankTitle !== undefined ? { consultationBankTitle: dto.bankTitle?.trim() || null } : {}),
      },
    });
    return this.getSettings();
  }

  // ── Paid consultation with the principal (Mr. Tashfeen) ───────────────────
  async consultAvailability(dateStr: string) {
    if (!isRealDay(dateStr)) throw new BadRequestException('Invalid date.');
    const org = await this.orgRow();
    if (!org?.principalEmployeeId) throw new BadRequestException('Set the principal in Reception settings first.');
    return this.appointments.getAvailability(org.principalEmployeeId, dateStr);
  }

  /**
   * "Pay-to-confirm" the in-person consultation, orchestrated server-side so the
   * desk needs no finance perms: attach an owner → book the slot → raise a
   * STANDALONE consultation invoice → record + verify the payment (receipt) →
   * CONFIRM the slot → notify.
   *
   * Double-charge safety: the money steps run only after an ATOMIC claim
   * (updateMany on feeAmount:null) wins, so concurrent submits and retries after
   * a partial failure cannot raise a second invoice/payment. The slot is booked
   * BEFORE the claim (a busy-slot 409 is then recoverable — pick another time),
   * and invoiceId/paymentId are stamped the instant each is created so a crash
   * never orphans money the visit can't reference. A claim that wins but then
   * fails mid-flow blocks re-collection (safe: no double charge) until
   * finance/admin reconciles the stuck invoice.
   */
  async collectConsultation(visitId: string, dto: CollectConsultationDto, actorUserId: string) {
    const visit = await this.prisma.visit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Visit not found');
    if (visit.visitType !== VisitType.PAID_CONSULT) {
      throw new BadRequestException('Only paid-consultation visits can collect a consultation fee.');
    }
    if (visit.paymentId) throw new BadRequestException('This consultation has already been paid.');
    if (!visit.appointmentId && !dto.scheduledAt) {
      throw new BadRequestException('Pick a time for the consultation.');
    }

    const org = await this.orgRow();
    const fee = org?.consultationFeeAmount != null ? Number(org.consultationFeeAmount) : 0;
    const currency = (org?.consultationFeeCurrency || '').toUpperCase();
    if (!org?.principalEmployeeId || !(fee > 0) || !currency) {
      throw new BadRequestException('Set the principal, consultation fee and currency in Reception settings first.');
    }

    // 1. The appointment engine requires a lead/client owner. A fresh paid-consult
    //    walk-in has neither, so match/create a lead first (needs a phone).
    const owner = await this.ensureConsultOwner(visit, actorUserId);

    // 2. Book the slot on the principal's calendar (still unpaid). A busy-slot 409
    //    happens BEFORE any money/claim, so the desk can just pick another time.
    //    appointmentId is stamped immediately so a retry reuses it (no dup slot).
    let appointmentId = visit.appointmentId;
    let scheduledAtIso: string;
    if (appointmentId) {
      const existing = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { scheduledAt: true } });
      scheduledAtIso = (existing?.scheduledAt ?? new Date()).toISOString();
    } else {
      const appt = await this.createConsultAppointment(
        org.principalEmployeeId,
        { name: visit.name, leadId: owner.leadId, clientId: owner.clientId, purpose: visit.purpose },
        dto.scheduledAt!,
        actorUserId,
      );
      appointmentId = appt.id;
      scheduledAtIso = appt.scheduledAt.toISOString();
      await this.prisma.visit.update({ where: { id: visitId }, data: { appointmentId } });
    }

    // 3. ATOMIC claim — only the request that flips feeAmount from null proceeds to
    //    money. Blocks concurrent double-submit AND retry-after-partial-failure.
    const claim = await this.prisma.visit.updateMany({
      where: { id: visitId, feeAmount: null, paymentId: null },
      data: { feeAmount: new Prisma.Decimal(fee), feeCurrency: currency },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This consultation is already paid or being processed. Refresh the desk.');
    }

    // 4. Money — a STANDALONE consultation invoice (no lead/client link, so it
    //    bypasses the service-agreement gate at both createInvoice and
    //    recordPayment); the customer linkage lives on the visit. invoiceId /
    //    paymentId are stamped the instant each exists so a partial failure never
    //    orphans money the visit can't reference.
    const invoice = await this.finance.createInvoice(
      {
        isConsultation: true,
        subtotal: fee.toFixed(2),
        currency,
        dueDate: new Date().toISOString(),
        notes: this.consultInvoiceNote(visit, org),
      },
      actorUserId,
    );
    await this.prisma.visit.update({ where: { id: visitId }, data: { invoiceId: invoice.id } });

    const payment = await this.finance.recordPayment(
      {
        invoiceId: invoice.id,
        amount: fee.toFixed(2),
        currency,
        paymentMethod: dto.paymentMethod?.trim() || 'cash',
        ...(dto.transactionRef?.trim() ? { transactionRef: dto.transactionRef.trim() } : {}),
        paidAt: new Date().toISOString(),
        notes: 'Consultation fee — creditable against a future service fee.',
      },
      actorUserId,
    );
    await this.prisma.visit.update({ where: { id: visitId }, data: { paymentId: payment.id } });

    const verified = await this.finance.verifyPayment(payment.id, {}, actorUserId);

    // 5. Pay-to-confirm: the slot is only CONFIRMED once paid.
    await this.appointments.update(appointmentId, { status: AppointmentStatus.CONFIRMED }, actorUserId);

    // 6. Finish stamping the visit's creditable flag (booking already linked).
    await this.prisma.visit.update({
      where: { id: visitId },
      data: { consultFeeCreditable: true },
    });

    // 7. Notify — best-effort, never breaks the completed payment.
    try {
      await this.whatsappNotifier.sendConfirmationFor(appointmentId, actorUserId, { kind: 'booked' });
    } catch (err) {
      this.log.warn(`consult WhatsApp confirm failed: ${(err as Error).message}`);
    }
    try {
      const principal = await this.prisma.employee.findFirst({
        where: { id: org.principalEmployeeId },
        select: { user: { select: { id: true } } },
      });
      if (principal?.user?.id) {
        await this.notifications.create({
          userId: principal.user.id,
          type: 'CONSULTATION_BOOKED',
          title: 'Paid consultation confirmed',
          body: `${visit.name} — fee paid (${currency} ${fee.toLocaleString()})`,
          link: '/sales/appointments',
        });
      }
    } catch (err) {
      this.log.warn(`consult principal notify failed: ${(err as Error).message}`);
    }

    return {
      receiptNumber: verified.receipt?.receiptNumber ?? null,
      invoiceNumber: invoice.invoiceNumber,
      appointmentId,
      scheduledAt: scheduledAtIso,
      feeAmount: fee,
      feeCurrency: currency,
    };
  }

  /**
   * The appointment engine requires a lead/client owner. Reuse the visit's link;
   * else match by phone or create a lead (round-robin). A paid-consult visitor
   * with no CRM record and no phone can't be booked — surface that clearly.
   */
  private async ensureConsultOwner(
    visit: { id: string; name: string; phone: string | null; leadId: string | null; clientId: string | null; purpose: string | null },
    actorUserId: string,
  ): Promise<{ leadId: string | null; clientId: string | null }> {
    if (visit.leadId || visit.clientId) return { leadId: visit.leadId, clientId: visit.clientId };
    if (!visit.phone) {
      throw new BadRequestException('Add a phone number (or link a lead/client) before booking the consultation.');
    }
    const matched = await this.matchByPhone(visit.phone);
    if (matched) {
      const link = matched.kind === 'client'
        ? { leadId: null, clientId: matched.id }
        : { leadId: matched.id, clientId: null };
      await this.prisma.visit.update({ where: { id: visit.id }, data: link });
      return link;
    }
    const leadId = await this.createWalkInLead(visit.name, visit.phone, visit.purpose, actorUserId);
    if (!leadId) throw new BadRequestException('Could not create a lead for this consultation.');
    await this.prisma.visit.update({ where: { id: visit.id }, data: { leadId } });
    return { leadId, clientId: null };
  }

  private createConsultAppointment(
    principalEmployeeId: string,
    owner: { name: string; leadId: string | null; clientId: string | null; purpose: string | null },
    scheduledAt: string,
    actorUserId: string,
  ) {
    return this.appointments.create(
      {
        assignedEmployeeId: principalEmployeeId,
        ...(owner.leadId ? { leadId: owner.leadId } : {}),
        ...(owner.clientId ? { clientId: owner.clientId } : {}),
        title: `Consultation — ${owner.name}`,
        appointmentType: 'PRINCIPAL_CONSULTATION',
        scheduledAt,
        durationMinutes: 30,
        location: 'Office',
        ...(owner.purpose ? { notes: owner.purpose } : {}),
      },
      actorUserId,
    );
  }

  // ── Reports / insights (footfall, conversion, consult revenue, no-shows) ──
  async getReports(query: ReceptionReportQueryDto) {
    const dayStart = (s: string) => new Date(`${s}T00:00:00.000+05:00`);
    const plusDay = (dt: Date) => new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    // PKT calendar date of an instant (add +05:00 then read the UTC date parts).
    const pktDay = (dt: Date) => new Date(dt.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const today = pktDay(new Date());
    let toStr = isRealDay(query.to) ? query.to! : today;
    let fromStr = isRealDay(query.from)
      ? query.from!
      : pktDay(new Date(dayStart(toStr).getTime() - 29 * 24 * 60 * 60 * 1000));
    if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr]; // normalise a reversed range
    // Cap the window so a stray wide range can't trigger an unbounded scan
    // (and an unbounded daily-trend map). A year is ample for a front desk.
    const MAX_DAYS = 366;
    if ((dayStart(toStr).getTime() - dayStart(fromStr).getTime()) / 86400000 + 1 > MAX_DAYS) {
      fromStr = pktDay(new Date(dayStart(toStr).getTime() - (MAX_DAYS - 1) * 24 * 60 * 60 * 1000));
    }
    const start = dayStart(fromStr);
    const end = plusDay(dayStart(toStr)); // exclusive upper bound
    const days = Math.round((dayStart(toStr).getTime() - dayStart(fromStr).getTime()) / 86400000) + 1;

    const visits = await this.prisma.visit.findMany({
      where: { checkedInAt: { gte: start, lt: end } },
      select: {
        visitType: true,
        status: true,
        checkedInAt: true,
        leadId: true,
        hostEmployeeId: true,
        paymentId: true,
        feeAmount: true,
        feeCurrency: true,
      },
    });

    // Footfall — totals + per-type + a per-day trend across the whole window.
    const byType = { WALK_IN: 0, EXISTING_CLIENT: 0, PAID_CONSULT: 0 };
    const status = { WAITING: 0, IN_MEETING: 0, DONE: 0, NO_SHOW: 0, CANCELLED: 0 };
    const dailyMap = new Map<string, { walkIn: number; existingClient: number; paidConsult: number; total: number }>();
    for (let d = dayStart(fromStr); d < end; d = plusDay(d)) {
      dailyMap.set(pktDay(d), { walkIn: 0, existingClient: 0, paidConsult: 0, total: 0 });
    }
    for (const v of visits) {
      byType[v.visitType] += 1;
      status[v.status] += 1;
      const bucket = dailyMap.get(pktDay(v.checkedInAt));
      if (bucket) {
        bucket.total += 1;
        if (v.visitType === VisitType.WALK_IN) bucket.walkIn += 1;
        else if (v.visitType === VisitType.EXISTING_CLIENT) bucket.existingClient += 1;
        else bucket.paidConsult += 1;
      }
    }
    const daily = [...dailyMap.entries()].map(([date, b]) => ({ date, ...b }));

    // Conversion — DISTINCT walk-in leads that have since become clients (a repeat
    // walk-in is one lead, not many). convertedClientId is the authoritative flag.
    const walkInLeadIds = [
      ...new Set(visits.filter((v) => v.visitType === VisitType.WALK_IN && v.leadId).map((v) => v.leadId!)),
    ];
    const leads = walkInLeadIds.length
      ? await this.prisma.lead.findMany({
          where: { id: { in: walkInLeadIds } },
          select: { id: true, convertedClientId: true },
        })
      : [];
    const converted = leads.filter((l) => l.convertedClientId).length;

    // Consultation revenue — sum the NATIVE fee stamped on paid consult visits,
    // grouped by currency (no FX; the visit carries the authoritative amount).
    const paidConsults = visits.filter((v) => v.visitType === VisitType.PAID_CONSULT && v.paymentId);
    const collectedMap = new Map<string, Prisma.Decimal>();
    for (const v of paidConsults) {
      if (v.feeAmount == null) continue;
      const cur = (v.feeCurrency || 'PKR').toUpperCase();
      collectedMap.set(cur, (collectedMap.get(cur) ?? new Prisma.Decimal(0)).plus(v.feeAmount));
    }
    // Sort desc so the "primary" currency the UI surfaces is deterministic
    // (findMany has no stable order) and the largest revenue leads.
    const collected = [...collectedMap.entries()]
      .map(([currency, amount]) => ({ currency, amount: Number(amount) }))
      .sort((a, b) => b.amount - a.amount);

    // Hosts — visits handled per staff member (skip unassigned).
    const hostCount = new Map<string, number>();
    for (const v of visits) {
      if (v.hostEmployeeId) hostCount.set(v.hostEmployeeId, (hostCount.get(v.hostEmployeeId) ?? 0) + 1);
    }
    const hostIds = [...hostCount.keys()];
    const emps = hostIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: hostIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));
    const hosts = [...hostCount.entries()]
      .map(([id, count]) => ({ id, name: nameById.get(id) ?? 'Unknown', visits: count }))
      .sort((a, b) => b.visits - a.visits);

    const total = visits.length;
    // No-show rate is over BOOKED footfall (exclude cancellations, which were
    // called off rather than missed) — guarded against divide-by-zero.
    const booked = total - status.CANCELLED;
    const noShowRate = booked > 0 ? status.NO_SHOW / booked : 0;

    return {
      range: { from: fromStr, to: toStr, days },
      footfall: {
        total,
        walkIn: byType.WALK_IN,
        existingClient: byType.EXISTING_CLIENT,
        paidConsult: byType.PAID_CONSULT,
        daily,
      },
      outcomes: {
        waiting: status.WAITING,
        inMeeting: status.IN_MEETING,
        done: status.DONE,
        noShow: status.NO_SHOW,
        cancelled: status.CANCELLED,
        noShowRate,
      },
      conversion: {
        walkIns: byType.WALK_IN,
        leads: walkInLeadIds.length,
        converted,
        conversionRate: walkInLeadIds.length > 0 ? converted / walkInLeadIds.length : 0,
      },
      consult: {
        count: paidConsults.length,
        noShow: paidConsults.filter((v) => v.status === VisitStatus.NO_SHOW).length,
        collected,
      },
      hosts,
    };
  }

  private consultInvoiceNote(
    visit: { name: string; phone: string | null },
    org: { consultationBankIban: string | null; consultationBankName: string | null; consultationBankTitle: string | null },
  ): string {
    const lines = [
      `In-person consultation fee — ${visit.name}${visit.phone ? ` (${visit.phone})` : ''}.`,
      'Creditable against a future service fee.',
    ];
    if (org.consultationBankIban) {
      const bank = [org.consultationBankName, org.consultationBankTitle, `IBAN ${org.consultationBankIban}`]
        .filter(Boolean)
        .join(' · ');
      lines.push(`Bank transfer: ${bank}`);
    }
    return lines.join('\n');
  }

  private orgRow() {
    return this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        principalEmployeeId: true,
        consultationFeeAmount: true,
        consultationFeeCurrency: true,
        consultationBankIban: true,
        consultationBankName: true,
        consultationBankTitle: true,
      },
    });
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
