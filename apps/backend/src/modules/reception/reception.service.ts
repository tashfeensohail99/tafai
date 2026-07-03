import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  Prisma,
  VisitStatus,
  VisitType,
  VisitorPaymentMethod,
  VisitorPaymentStatus,
  WhatsAppThreadStatus,
} from '@prisma/client';
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
  VisitorPaymentQueryDto,
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

    // A paid-consult visit with a pending bank transfer is neither "paid" nor
    // collectable again — flag it so the desk shows "awaiting verification".
    const pcUnpaidIds = visits.filter((v) => v.visitType === VisitType.PAID_CONSULT && !v.paymentId).map((v) => v.id);
    const pendingVps = pcUnpaidIds.length
      ? await this.prisma.visitorPayment.findMany({
          where: { visitId: { in: pcUnpaidIds }, status: VisitorPaymentStatus.PENDING_REVIEW },
          select: { visitId: true },
        })
      : [];
    const pendingSet = new Set(pendingVps.map((p) => p.visitId));

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
      // Paid consultation (phase 2 / P4a).
      paid: !!v.paymentId,
      pendingPayment: pendingSet.has(v.id),
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
    const method = dto.method ?? VisitorPaymentMethod.CASH;

    const org = await this.orgRow();
    const fee = org?.consultationFeeAmount != null ? Number(org.consultationFeeAmount) : 0;
    const currency = (org?.consultationFeeCurrency || '').toUpperCase();
    if (!org?.principalEmployeeId || !(fee > 0) || !currency) {
      throw new BadRequestException('Set the principal, consultation fee and currency in Reception settings first.');
    }

    // 1. The appointment engine requires a lead/client owner. A fresh paid-consult
    //    walk-in has neither, so match/create a lead first (needs a phone).
    const owner = await this.ensureConsultOwner(visit, actorUserId);

    // 2. Book / hold the slot on the principal's calendar (still unpaid). A busy-slot
    //    409 happens BEFORE any money/claim, so the desk can just pick another time.
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

    // 3+4. ATOMIC claim + create the VisitorPayment in ONE transaction — only the
    //    request that flips feeAmount from null proceeds, and the register/queue row
    //    is created in the same commit, so a failure can never leave feeAmount set
    //    with no VisitorPayment (which would wedge re-collection). Released again on
    //    reject so a rejected bank transfer can be re-collected.
    const vp = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.visit.updateMany({
        where: { id: visitId, feeAmount: null, paymentId: null },
        data: { feeAmount: new Prisma.Decimal(fee), feeCurrency: currency },
      });
      if (claim.count === 0) {
        throw new BadRequestException('This consultation is already paid or being processed. Refresh the desk.');
      }
      return tx.visitorPayment.create({
        data: {
          visitId,
          method,
          status: VisitorPaymentStatus.PENDING_REVIEW,
          amount: new Prisma.Decimal(fee),
          currency,
          ...(dto.transactionRef?.trim() ? { transactionRef: dto.transactionRef.trim() } : {}),
          createdByUserId: actorUserId,
        },
      });
    });

    if (method === VisitorPaymentMethod.BANK_TRANSFER) {
      // Hold the slot; DON'T touch the finance ledger yet — the invoice + payment
      // + receipt are created only when finance verifies (correct revenue timing).
      await this.sendVisitText(
        owner.leadId,
        owner.clientId,
        "We've received your payment details — your consultation is being verified and we'll confirm shortly.",
      );
      await this.notifyPrincipal(
        org.principalEmployeeId,
        `${visit.name} — bank transfer pending verification (${currency} ${fee.toLocaleString()})`,
      );
      return {
        status: 'pending' as const,
        method: 'BANK_TRANSFER' as const,
        visitorPaymentId: vp.id,
        appointmentId,
        scheduledAt: scheduledAtIso,
        feeAmount: fee,
        feeCurrency: currency,
        receiptNumber: null,
        invoiceNumber: null,
      };
    }

    // CASH — verified at the counter: run the SAME finalize path immediately.
    const fin = await this.finalizeVisitorPayment(vp.id, actorUserId);
    return {
      status: 'confirmed' as const,
      method: 'CASH' as const,
      receiptNumber: fin.receiptNumber,
      invoiceNumber: fin.invoiceNumber,
      appointmentId,
      scheduledAt: scheduledAtIso,
      feeAmount: fee,
      feeCurrency: currency,
    };
  }

  /** Finance verifies a pending consultation payment (or a bank transfer). Thin
   *  wrapper over the shared finalize path so cash + bank share one state machine. */
  async verifyVisitorPayment(id: string, actorUserId: string) {
    const existing = await this.prisma.visitorPayment.findUnique({
      where: { id },
      select: { status: true, receiptNumber: true },
    });
    if (!existing) throw new NotFoundException('Payment not found');
    if (existing.status === VisitorPaymentStatus.VERIFIED) {
      return { alreadyVerified: true as const, receiptNumber: existing.receiptNumber };
    }
    if (existing.status === VisitorPaymentStatus.REJECTED) {
      throw new BadRequestException('This payment was rejected.');
    }
    const fin = await this.finalizeVisitorPayment(id, actorUserId);
    return {
      alreadyVerified: false as const,
      receiptNumber: fin.receiptNumber,
      invoiceNumber: fin.invoiceNumber,
      appointmentId: fin.appointmentId,
    };
  }

  /**
   * The shared "recognise the money" path for a consultation payment. An ATOMIC
   * claim moves PENDING_REVIEW -> VERIFYING (a distinct transient state), so a
   * concurrent reject or second verify can't touch the row mid-flight. The money
   * chain is resume-safe (reuses any invoice/payment a prior failed attempt made,
   * so a retry never double-charges); on failure the claim rolls back to
   * PENDING_REVIEW so it can be retried.
   */
  private async finalizeVisitorPayment(
    id: string,
    actorUserId: string,
  ): Promise<{ invoiceNumber: string | null; receiptNumber: string | null; appointmentId: string }> {
    // Pre-flight loads BEFORE the claim — so a "no slot"/"no org" throw never
    // leaves the row stuck in VERIFYING (which the claim, below, would strand).
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id } });
    if (!vp) throw new NotFoundException('Payment not found');
    const visit = await this.prisma.visit.findUnique({ where: { id: vp.visitId } });
    if (!visit) throw new NotFoundException('Visit not found');
    if (!visit.appointmentId) throw new BadRequestException('This consultation has no booked slot to confirm.');
    const org = await this.orgRow();
    if (!org) throw new NotFoundException('Organization not configured');

    // Atomic claim PENDING_REVIEW -> VERIFYING; only now is the row locked, and
    // everything after runs inside the try so any throw rolls it back.
    const claim = await this.prisma.visitorPayment.updateMany({
      where: { id, status: VisitorPaymentStatus.PENDING_REVIEW },
      data: { status: VisitorPaymentStatus.VERIFYING, verifiedByUserId: actorUserId },
    });
    if (claim.count === 0) throw new BadRequestException('This payment is already verified or being verified.');

    try {
      const fin = await this.finalizeConsultPayment(
        { id: vp.id, invoiceId: vp.invoiceId, paymentId: vp.paymentId },
        { name: visit.name, phone: visit.phone },
        org,
        {
          amount: Number(vp.amount),
          currency: vp.currency,
          appointmentId: visit.appointmentId,
          paymentMethod: vp.method === VisitorPaymentMethod.CASH ? 'cash' : 'bank_transfer',
          transactionRef: vp.transactionRef ?? undefined,
        },
        actorUserId,
      );
      // FULL SUCCESS ONLY: now mark the visit paid — this is what getReports counts
      // as revenue and what the collect guard reads. A rolled-back attempt never
      // reaches here, so a recorded-but-unverified payment is never counted paid.
      await this.prisma.visit.update({
        where: { id: visit.id },
        data: { invoiceId: fin.invoiceId, paymentId: fin.paymentId, consultFeeCreditable: true },
      });
      await this.prisma.visitorPayment.update({
        where: { id },
        data: {
          status: VisitorPaymentStatus.VERIFIED,
          verifiedAt: new Date(),
          invoiceId: fin.invoiceId,
          paymentId: fin.paymentId,
          receiptNumber: fin.receiptNumber,
        },
      });
      return { invoiceNumber: fin.invoiceNumber, receiptNumber: fin.receiptNumber, appointmentId: visit.appointmentId };
    } catch (err) {
      // Roll the claim back so the payment can be retried. finalizeConsultPayment
      // is resume-safe (invoice/payment anchored on the VisitorPayment), so
      // re-running it never double-charges, and the visit was never marked paid.
      await this.prisma.visitorPayment.updateMany({
        where: { id, status: VisitorPaymentStatus.VERIFYING },
        data: { status: VisitorPaymentStatus.PENDING_REVIEW },
      });
      throw err;
    }
  }

  /** Finance rejects a pending payment: release the held slot + the fee claim so
   *  the desk can re-collect, and let the customer know. The CAS keys on
   *  PENDING_REVIEW (not a VERIFYING row mid-verify), so verify + reject are
   *  mutually exclusive. No ledger rows exist for a pending transfer, so there's
   *  nothing to void. */
  async rejectVisitorPayment(id: string, reason: string, actorUserId: string) {
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id } });
    if (!vp) throw new NotFoundException('Payment not found');
    if (vp.status !== VisitorPaymentStatus.PENDING_REVIEW) {
      throw new BadRequestException('Only a pending payment can be rejected.');
    }
    // Guard: if a prior verify attempt already took the money (payment PAID) but a
    // later step failed and rolled the row back, don't reject it — that would strand
    // real money + an issued receipt. Route to the finance refund flow instead.
    if (vp.paymentId) {
      const pay = await this.prisma.payment.findUnique({ where: { id: vp.paymentId }, select: { status: true } });
      if (pay?.status === 'PAID') {
        throw new BadRequestException('This payment was already taken and receipted — use the finance refund flow, not reject.');
      }
    }
    // Atomic CAS PENDING_REVIEW -> REJECTED. A verify that already claimed the row
    // moved it to VERIFYING, so this no longer matches — the two never overlap.
    const claim = await this.prisma.visitorPayment.updateMany({
      where: { id, status: VisitorPaymentStatus.PENDING_REVIEW },
      data: {
        status: VisitorPaymentStatus.REJECTED,
        rejectedReason: reason?.trim() || 'Payment could not be verified',
        verifiedByUserId: actorUserId,
        verifiedAt: new Date(),
      },
    });
    if (claim.count === 0) throw new BadRequestException('This payment is already being verified or was handled.');

    const visit = await this.prisma.visit.findUnique({ where: { id: vp.visitId } });
    if (visit?.appointmentId) {
      try {
        await this.appointments.update(visit.appointmentId, { status: AppointmentStatus.CANCELLED }, actorUserId);
      } catch (err) {
        this.log.warn(`consult reject: cancel appointment failed: ${(err as Error).message}`);
      }
    }
    // Release the slot link + fee claim so a fresh collection can be started.
    await this.prisma.visit.update({
      where: { id: vp.visitId },
      data: { appointmentId: null, feeAmount: null, feeCurrency: null },
    });
    await this.sendVisitText(
      visit?.leadId ?? null,
      visit?.clientId ?? null,
      "We couldn't verify your consultation payment yet. Please resend the transfer receipt or pay at the front desk.",
    );
    return { status: 'rejected' as const };
  }

  /** Register + finance queue over consultation payments (cash vs bank, pending). */
  async listVisitorPayments(query: VisitorPaymentQueryDto) {
    const dayStart = (s: string) => new Date(`${s}T00:00:00.000+05:00`);
    const plusDay = (dt: Date) => new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    const where: Prisma.VisitorPaymentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.method) where.method = query.method;
    if (isRealDay(query.from) || isRealDay(query.to)) {
      const from = isRealDay(query.from) ? query.from! : query.to!;
      const to = isRealDay(query.to) ? query.to! : query.from!;
      const [a, b] = from <= to ? [from, to] : [to, from];
      where.createdAt = { gte: dayStart(a), lt: plusDay(dayStart(b)) };
    }

    const rows = await this.prisma.visitorPayment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const visitIds = [...new Set(rows.map((r) => r.visitId))];
    const visits = visitIds.length
      ? await this.prisma.visit.findMany({ where: { id: { in: visitIds } }, select: { id: true, name: true, phone: true } })
      : [];
    const vmap = new Map(visits.map((v) => [v.id, v]));

    const out = rows.map((r) => ({
      id: r.id,
      visitId: r.visitId,
      name: vmap.get(r.visitId)?.name ?? '—',
      phone: vmap.get(r.visitId)?.phone ?? null,
      method: r.method,
      status: r.status,
      amount: Number(r.amount),
      currency: r.currency,
      transactionRef: r.transactionRef,
      receiptNumber: r.receiptNumber,
      createdAt: r.createdAt.toISOString(),
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      rejectedReason: r.rejectedReason,
    }));

    // Register totals per currency: verified cash vs bank, plus pending pool.
    let pendingCount = 0;
    const byCurrency: Record<string, { cash: number; bank: number; pending: number }> = {};
    for (const r of rows) {
      const bucket = (byCurrency[r.currency] ??= { cash: 0, bank: 0, pending: 0 });
      if (r.status === VisitorPaymentStatus.VERIFIED) {
        if (r.method === VisitorPaymentMethod.CASH) bucket.cash += Number(r.amount);
        else bucket.bank += Number(r.amount);
      } else if (r.status === VisitorPaymentStatus.PENDING_REVIEW) {
        bucket.pending += Number(r.amount);
        pendingCount += 1;
      }
    }

    return { rows: out, totals: { pendingCount, byCurrency } };
  }

  /**
   * The shared money chain for a confirmed consultation fee (cash-at-desk or a
   * finance-verified bank transfer): standalone consultation invoice → record +
   * verify payment (receipt) → CONFIRM the slot → best-effort WhatsApp confirm +
   * principal bell. Resume-safe: the invoice/payment ids are anchored on the
   * VisitorPayment (NOT the visit), so a rolled-back attempt is retried without a
   * second invoice/payment, and the visit is marked paid only by the caller on
   * full success — a partial failure never counts as revenue or blocks re-collect.
   */
  private async finalizeConsultPayment(
    vp: { id: string; invoiceId: string | null; paymentId: string | null },
    visit: { name: string; phone: string | null },
    org: { principalEmployeeId: string | null; consultationBankIban: string | null; consultationBankName: string | null; consultationBankTitle: string | null },
    params: { amount: number; currency: string; appointmentId: string; paymentMethod: string; transactionRef?: string },
    actorUserId: string,
  ): Promise<{ invoiceId: string; invoiceNumber: string; paymentId: string; receiptNumber: string | null }> {
    let invoiceId = vp.invoiceId;
    let invoiceNumber: string;
    if (invoiceId) {
      const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceNumber: true } });
      invoiceNumber = inv?.invoiceNumber ?? '—';
    } else {
      const invoice = await this.finance.createInvoice(
        {
          isConsultation: true,
          subtotal: params.amount.toFixed(2),
          currency: params.currency,
          dueDate: new Date().toISOString(),
          notes: this.consultInvoiceNote(visit, org),
        },
        actorUserId,
      );
      invoiceId = invoice.id;
      invoiceNumber = invoice.invoiceNumber;
      await this.prisma.visitorPayment.update({ where: { id: vp.id }, data: { invoiceId } });
    }

    let paymentId = vp.paymentId;
    if (!paymentId) {
      const payment = await this.finance.recordPayment(
        {
          invoiceId,
          amount: params.amount.toFixed(2),
          currency: params.currency,
          paymentMethod: params.paymentMethod,
          ...(params.transactionRef ? { transactionRef: params.transactionRef } : {}),
          paidAt: new Date().toISOString(),
          notes: 'Consultation fee — creditable against a future service fee.',
        },
        actorUserId,
      );
      paymentId = payment.id;
      await this.prisma.visitorPayment.update({ where: { id: vp.id }, data: { paymentId } });
    }

    // Verify idempotently: if a prior attempt already set the payment PAID, don't
    // re-verify (that would throw) — recover the already-issued receipt number.
    let receiptNumber: string | null = null;
    const existingPayment = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
    if (existingPayment?.status === 'PAID') {
      const rc = await this.prisma.receipt.findUnique({ where: { paymentId }, select: { receiptNumber: true } });
      receiptNumber = rc?.receiptNumber ?? null;
    } else {
      const verified = await this.finance.verifyPayment(paymentId, {}, actorUserId);
      receiptNumber = verified.receipt?.receiptNumber ?? null;
    }

    // Pay-to-confirm: the slot is only CONFIRMED once paid + verified.
    await this.appointments.update(params.appointmentId, { status: AppointmentStatus.CONFIRMED }, actorUserId);

    try {
      await this.whatsappNotifier.sendConfirmationFor(params.appointmentId, actorUserId, { kind: 'booked' });
    } catch (err) {
      this.log.warn(`consult WhatsApp confirm failed: ${(err as Error).message}`);
    }
    await this.notifyPrincipal(
      org.principalEmployeeId,
      `${visit.name} — fee paid (${params.currency} ${params.amount.toLocaleString()})`,
    );

    return { invoiceId, invoiceNumber, paymentId, receiptNumber };
  }

  /** Bell the principal about a consultation (best-effort). */
  private async notifyPrincipal(principalEmployeeId: string | null, body: string) {
    if (!principalEmployeeId) return;
    try {
      const principal = await this.prisma.employee.findFirst({
        where: { id: principalEmployeeId },
        select: { user: { select: { id: true } } },
      });
      if (principal?.user?.id) {
        await this.notifications.create({
          userId: principal.user.id,
          type: 'CONSULTATION_BOOKED',
          title: 'Paid consultation',
          body,
          link: '/sales/appointments',
        });
      }
    } catch (err) {
      this.log.warn(`consult principal notify failed: ${(err as Error).message}`);
    }
  }

  /** Free-text WhatsApp to the visitor's open thread (best-effort, 24h window). */
  private async sendVisitText(leadId: string | null, clientId: string | null, body: string) {
    if (!leadId && !clientId) return;
    try {
      const thread = await this.prisma.whatsAppThread.findFirst({
        where: {
          ...(leadId ? { leadId } : {}),
          ...(!leadId && clientId ? { clientId } : {}),
          status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
          windowExpiresAt: { gt: new Date() },
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      });
      if (thread) await this.whatsappNotifier.sendBotText(thread.id, body);
    } catch (err) {
      this.log.warn(`consult visit text failed: ${(err as Error).message}`);
    }
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
