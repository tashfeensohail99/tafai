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
import * as QRCode from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';
import { FinanceService } from '../finance/finance.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsAppAppointmentNotifierService } from '../whatsapp/notifications/appointment-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { OpenAiService } from '../ai/openai.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ConsultPayTokenService } from './consult-pay-token.service';
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
    private readonly storage: StorageService,
    private readonly payToken: ConsultPayTokenService,
    private readonly openai: OpenAiService,
    private readonly apiKeys: ApiKeysService,
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

    const updated = await this.prisma.visit.update({ where: { id }, data });

    // A paid consultation marked NO_SHOW → nudge the customer to rebook (approved
    // UTILITY template; works outside the 24h window). Fire once per transition
    // (guard on the PRIOR status so re-saving NO_SHOW doesn't re-send), best-effort.
    if (
      dto.status === VisitStatus.NO_SHOW &&
      visit.status !== VisitStatus.NO_SHOW &&
      visit.visitType === VisitType.PAID_CONSULT &&
      visit.appointmentId
    ) {
      void this.notifyConsultNoShow(visit);
    }

    return updated;
  }

  /** Fire-and-forget consultation_no_show nudge for a missed paid consult. */
  private async notifyConsultNoShow(visit: {
    id: string;
    name: string;
    phone: string | null;
    leadId: string | null;
    clientId: string | null;
    appointmentId: string | null;
    whatsappConsent: boolean;
  }): Promise<void> {
    try {
      const appt = visit.appointmentId
        ? await this.prisma.appointment.findUnique({ where: { id: visit.appointmentId }, select: { scheduledAt: true } })
        : null;
      await this.whatsappNotifier.sendConsultTemplate({
        leadId: visit.leadId,
        clientId: visit.clientId,
        phone: visit.phone,
        templateName: 'consultation_no_show',
        bodyParams: [this.firstNameOf(visit.name), appt ? this.formatSlotPkt(appt.scheduledAt) : 'your booked time'],
        idempotencyKey: `consult-noshow-${visit.id}`,
        consent: visit.whatsappConsent,
      });
    } catch (err) {
      this.log.warn(`consult no-show notify failed: ${(err as Error).message}`);
    }
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
    // Capture WhatsApp opt-in for this consult before any template fires. Persist
    // to the row (so the re-loaded visit in the finance chain sees it) and reflect
    // it locally for the immediate bank-transfer "received" send.
    if (dto.whatsappConsent !== undefined && dto.whatsappConsent !== visit.whatsappConsent) {
      await this.prisma.visit.update({ where: { id: visitId }, data: { whatsappConsent: dto.whatsappConsent } });
      visit.whatsappConsent = dto.whatsappConsent;
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
      // Tell the customer via the approved UTILITY template (works even if there's
      // no open 24h window — a walk-in usually hasn't messaged us). Fire-and-forget.
      void this.sendPaymentNotify(vp.id, {
        leadId: owner.leadId,
        clientId: owner.clientId,
        phone: visit.phone,
        templateName: 'consultation_payment_received',
        bodyParams: [
          this.firstNameOf(visit.name),
          `${currency} ${fee.toLocaleString()}`,
          this.formatSlotPkt(new Date(scheduledAtIso)),
        ],
        idempotencyKey: `consult-received-${vp.id}`,
        consent: visit.whatsappConsent,
      });
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
        { name: visit.name, phone: visit.phone, leadId: visit.leadId, clientId: visit.clientId },
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
      // Money is committed — fire the "confirmed" WhatsApp template (works outside
      // the 24h window). Fire-and-forget AFTER the writes so a send failure can
      // never roll back the payment. Idempotency-keyed on the visit so a resumed
      // finalize (which can't re-reach this block anyway) never double-sends.
      void this.notifyConsultConfirmed(vp.id, visit, Number(vp.amount), vp.currency, org.principalEmployeeId);
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
    // Capture the slot for the customer message BEFORE we release it below.
    const appt = visit?.appointmentId
      ? await this.prisma.appointment.findUnique({ where: { id: visit.appointmentId }, select: { scheduledAt: true } })
      : null;
    if (visit?.appointmentId) {
      // Free the slot before nulling the link. If the cancel fails, roll the claim
      // back to PENDING_REVIEW and surface the error so the officer retries — nulling
      // the link on a failed cancel would strand a CONFIRMED appointment (busy in
      // availability) with nothing pointing to it, silently blocking the calendar.
      try {
        await this.appointments.update(visit.appointmentId, { status: AppointmentStatus.CANCELLED }, actorUserId);
      } catch (err) {
        await this.prisma.visitorPayment
          .updateMany({
            where: { id, status: VisitorPaymentStatus.REJECTED },
            data: { status: VisitorPaymentStatus.PENDING_REVIEW, rejectedReason: null, verifiedByUserId: null, verifiedAt: null },
          })
          .catch(() => {});
        this.log.warn(`consult reject: cancel appointment failed: ${(err as Error).message}`);
        throw new BadRequestException('Could not release the appointment slot — please try again.');
      }
    }
    // Release the slot link + fee claim so a fresh collection can be started.
    await this.prisma.visit.update({
      where: { id: vp.visitId },
      data: { appointmentId: null, feeAmount: null, feeCurrency: null },
    });
    // Tell the customer via the approved UTILITY template so it reaches them even
    // with no open 24h window (a walk-in usually never messaged us) — the old
    // window-gated free text silently dropped for exactly those customers.
    void this.sendPaymentNotify(id, {
      leadId: visit?.leadId ?? null,
      clientId: visit?.clientId ?? null,
      phone: visit?.phone ?? null,
      templateName: 'consultation_slot_released',
      bodyParams: [this.firstNameOf(visit?.name), appt ? this.formatSlotPkt(appt.scheduledAt) : 'your consultation'],
      idempotencyKey: `consult-released-${id}`,
      consent: visit?.whatsappConsent ?? true,
    });
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

    // Sign the uploaded-receipt images (bank transfers only) so the finance
    // verify screen can show them inline. Best-effort — a signing failure just
    // drops the thumbnail, never the row.
    const proofUrls = new Map<string, string>();
    await Promise.all(
      rows
        .filter((r) => r.proofImageKey)
        .map(async (r) => {
          try {
            proofUrls.set(r.id, await this.storage.getSignedUrl(r.proofImageKey!));
          } catch (err) {
            this.log.warn(`consult proof url failed: ${(err as Error).message}`);
          }
        }),
    );

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
      hasProof: !!r.proofImageKey,
      proofUrl: proofUrls.get(r.id) ?? null,
      // Advisory OCR read of the uploaded receipt (P4c) — finance still confirms.
      ocrStatus: r.ocrStatus,
      ocrAmount: r.ocrAmount != null ? Number(r.ocrAmount) : null,
      ocrCurrency: r.ocrCurrency, // what the model read on the receipt (may differ from expected)
      ocrReference: r.ocrReference,
      ocrBankName: r.ocrBankName,
      ocrPaidAt: r.ocrPaidAt?.toISOString() ?? null,
      ocrConfidence: r.ocrConfidence,
      createdAt: r.createdAt.toISOString(),
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      rejectedReason: r.rejectedReason,
      // Outcome of the last customer WhatsApp notify (SENT / SKIPPED / FAILED).
      notifyStatus: r.notifyStatus,
      notifyAt: r.notifyAt?.toISOString() ?? null,
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

  // ── QR self-upload (P4b): customer scans a desk QR → public upload page ────

  /** A QR + link the desk shows so the customer can scan and upload their
   *  transfer receipt. Only for a pending bank transfer. */
  async getPayQr(visitorPaymentId: string) {
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id: visitorPaymentId } });
    if (!vp) throw new NotFoundException('Payment not found');
    if (vp.method !== VisitorPaymentMethod.BANK_TRANSFER || vp.status !== VisitorPaymentStatus.PENDING_REVIEW) {
      throw new BadRequestException('A receipt upload is only available for a pending bank transfer.');
    }
    const { token, expiresAt } = this.payToken.make(vp.id);
    const base = (process.env.FRONTEND_URL ?? 'https://tashfeengroup.com').replace(/\/$/, '');
    const payUrl = `${base}/pay/${token}`;
    const qrDataUrl = await QRCode.toDataURL(payUrl, { width: 320, margin: 1 });
    return { token, payUrl, qrDataUrl, expiresAt };
  }

  /**
   * Send the customer a WhatsApp reminder to complete a still-unpaid bank
   * transfer, with a fresh pay-link button (the approved consultation_payment_
   * reminder template). Manual, staff-triggered — only for a PENDING bank
   * transfer. The button token is a fresh 1h pay token for the /pay page.
   */
  async sendPaymentReminder(visitorPaymentId: string): Promise<{ sent: boolean; reason?: string }> {
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id: visitorPaymentId } });
    if (!vp) throw new NotFoundException('Payment not found');
    if (vp.method !== VisitorPaymentMethod.BANK_TRANSFER || vp.status !== VisitorPaymentStatus.PENDING_REVIEW) {
      throw new BadRequestException('A reminder can only be sent for a pending bank transfer.');
    }
    const visit = await this.prisma.visit.findUnique({ where: { id: vp.visitId } });
    if (!visit) throw new NotFoundException('Visit not found');
    if (!visit.phone) throw new BadRequestException('This visitor has no phone number to message.');

    const appt = visit.appointmentId
      ? await this.prisma.appointment.findUnique({ where: { id: visit.appointmentId }, select: { scheduledAt: true } })
      : null;
    const { token } = this.payToken.make(vp.id);
    return this.whatsappNotifier.sendConsultTemplate({
      leadId: visit.leadId,
      clientId: visit.clientId,
      phone: visit.phone,
      templateName: 'consultation_payment_reminder',
      bodyParams: [
        this.firstNameOf(visit.name),
        appt ? this.formatSlotPkt(appt.scheduledAt) : 'your consultation',
        `${vp.currency} ${Number(vp.amount).toLocaleString()}`,
      ],
      buttonUrlToken: token,
      consent: visit.whatsappConsent,
    });
  }

  // ── Periodic maintenance (driven by ReceptionSweeperService) ────────────────

  /** How long an unpaid bank transfer may hold the principal's slot before the
   *  sweeper auto-releases it. */
  private static readonly STALE_PENDING_HOURS = 48;

  /**
   * One maintenance pass. Best-effort — each step is independently guarded so one
   * failure never blocks the others. (a) auto-release a bank transfer that has sat
   * unpaid too long (frees the held slot + fee-claim so the principal's calendar
   * doesn't rot and the desk can re-collect); (b) recover a VERIFYING row stranded
   * by a worker that died mid-verify (the money chain is resume-safe); (c) fire the
   * ~24h / ~2h customer appointment reminders for confirmed paid consults.
   */
  async sweepStaleConsults(): Promise<void> {
    const now = Date.now();

    // (a) Stale unpaid bank transfers → release.
    const staleBefore = new Date(now - ReceptionService.STALE_PENDING_HOURS * 3_600_000);
    const stale = await this.prisma.visitorPayment.findMany({
      where: {
        status: VisitorPaymentStatus.PENDING_REVIEW,
        method: VisitorPaymentMethod.BANK_TRANSFER,
        // ONLY release genuinely-unpaid holds. A row carrying a proofImageKey means
        // the customer uploaded a receipt — that is (probably real) money awaiting
        // finance review, never something to auto-reject with "payment not received".
        // Those stay pending until a human verifies or rejects them.
        proofImageKey: null,
        createdAt: { lt: staleBefore },
      },
      select: { id: true },
      take: 50,
    });
    for (const s of stale) {
      try {
        await this.systemReleasePendingPayment(s.id);
      } catch (e) {
        this.log.warn(`sweep release ${s.id} failed: ${(e as Error).message}`);
      }
    }

    // (b) Stuck VERIFYING (worker died mid-verify) → back to PENDING_REVIEW so it's
    //     retryable + visible in the finance queue again. Money chain is resume-safe.
    //     15-min TTL (not 5): verifyPayment isn't one transaction and includes an
    //     inline receipt-PDF render + S3 upload, so a live-but-slow verify can hold
    //     VERIFYING for minutes; a tighter TTL would resurrect it mid-flight and
    //     cause a redundant re-verify. A genuinely dead worker is still rescued.
    await this.prisma.visitorPayment
      .updateMany({
        where: { status: VisitorPaymentStatus.VERIFYING, updatedAt: { lt: new Date(now - 15 * 60 * 1000) } },
        data: { status: VisitorPaymentStatus.PENDING_REVIEW },
      })
      .catch((e) => this.log.warn(`sweep verifying reset failed: ${(e as Error).message}`));

    // (c) 24h / 2h reminders for confirmed, paid consults.
    try {
      await this.sweepConsultReminders(now);
    } catch (e) {
      this.log.warn(`sweep reminders failed: ${(e as Error).message}`);
    }
  }

  /** Release a stale unpaid pending bank transfer (system-attributed reject). */
  private async systemReleasePendingPayment(id: string): Promise<void> {
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id } });
    if (!vp || vp.status !== VisitorPaymentStatus.PENDING_REVIEW) return;
    // Never auto-release money that was actually taken + receipted.
    if (vp.paymentId) {
      const pay = await this.prisma.payment.findUnique({ where: { id: vp.paymentId }, select: { status: true } });
      if (pay?.status === 'PAID') return;
    }
    const claim = await this.prisma.visitorPayment.updateMany({
      where: { id, status: VisitorPaymentStatus.PENDING_REVIEW },
      data: { status: VisitorPaymentStatus.REJECTED, rejectedReason: 'Auto-released: payment not received in time', verifiedAt: new Date() },
    });
    if (claim.count === 0) return; // a concurrent verify/reject already handled it
    const visit = await this.prisma.visit.findUnique({ where: { id: vp.visitId } });
    const appt = visit?.appointmentId
      ? await this.prisma.appointment.findUnique({ where: { id: visit.appointmentId }, select: { scheduledAt: true } })
      : null;
    if (visit?.appointmentId) {
      // The slot MUST be freed before we null the visit link. If the cancel fails,
      // roll the claim back to PENDING_REVIEW and bail — the next sweep retries the
      // whole release atomically. Nulling the link on a failed cancel would strand
      // a CONFIRMED appointment that availability treats as busy, with nothing left
      // pointing to it, silently blocking the principal's calendar forever.
      try {
        await this.appointments.update(visit.appointmentId, { status: AppointmentStatus.CANCELLED }, vp.createdByUserId);
      } catch (e) {
        await this.prisma.visitorPayment
          .updateMany({
            where: { id, status: VisitorPaymentStatus.REJECTED },
            data: { status: VisitorPaymentStatus.PENDING_REVIEW, rejectedReason: null, verifiedAt: null },
          })
          .catch(() => {});
        this.log.warn(`sweep release ${id}: appt cancel failed, rolled back for retry: ${(e as Error).message}`);
        return;
      }
    }
    await this.prisma.visit.update({
      where: { id: vp.visitId },
      data: { appointmentId: null, feeAmount: null, feeCurrency: null },
    });
    void this.sendPaymentNotify(id, {
      leadId: visit?.leadId ?? null,
      clientId: visit?.clientId ?? null,
      phone: visit?.phone ?? null,
      templateName: 'consultation_slot_released',
      bodyParams: [this.firstNameOf(visit?.name), appt ? this.formatSlotPkt(appt.scheduledAt) : 'your consultation'],
      idempotencyKey: `consult-released-${id}`,
      consent: visit?.whatsappConsent ?? true,
    });
  }

  /** Fire the ~24h / ~2h reminder for confirmed, paid consults. Idempotency-keyed
   *  per appointment+offset so each reminder goes out exactly once. */
  private async sweepConsultReminders(now: number): Promise<void> {
    const horizon = new Date(now + 24 * 3_600_000 + 30 * 60_000);
    const appts = await this.prisma.appointment.findMany({
      where: { status: AppointmentStatus.CONFIRMED, scheduledAt: { gt: new Date(now), lt: horizon } },
      select: { id: true, scheduledAt: true },
      take: 200,
    });
    if (appts.length === 0) return;
    const apptMap = new Map(appts.map((a) => [a.id, a.scheduledAt]));
    const visits = await this.prisma.visit.findMany({
      where: {
        visitType: VisitType.PAID_CONSULT,
        paymentId: { not: null },
        whatsappConsent: true,
        appointmentId: { in: appts.map((a) => a.id) },
      },
      select: { name: true, phone: true, leadId: true, clientId: true, appointmentId: true },
    });
    for (const v of visits) {
      const when = v.appointmentId ? apptMap.get(v.appointmentId) : undefined;
      if (!when) continue;
      const offset = ReceptionService.reminderOffsetFor((when.getTime() - now) / 60_000);
      if (!offset) continue;
      void this.whatsappNotifier.sendConsultTemplate({
        leadId: v.leadId,
        clientId: v.clientId,
        phone: v.phone,
        templateName: 'consultation_reminder',
        bodyParams: [this.firstNameOf(v.name), this.formatSlotPkt(when)],
        // Key on the SLOT TIME, not just the appointment id — a reschedule moves
        // scheduledAt in place (same appointment id), so a time-less key would let
        // the old reminder's row dedupe the new time's reminder and the customer
        // would never be reminded of their moved slot.
        idempotencyKey: `consult-reminder-${v.appointmentId}-${when.getTime()}-${offset}`,
        consent: true,
      });
    }
  }

  /** PUBLIC (token-gated): fee + our receiving-bank details for the pay page.
   *  No customer PII is returned — just the amount + where to send it. */
  async getConsultPayInfo(token: string) {
    const vpId = this.payToken.verify(token);
    if (!vpId) throw new NotFoundException('This link is invalid or has expired.');
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id: vpId } });
    if (!vp) throw new NotFoundException('This link is invalid or has expired.');
    // Only hand out the receiving-bank details while the payment is still
    // awaiting a transfer. Once finance has verified/rejected it, the page
    // shows an "already handled" state — no need to keep exposing our bank
    // block for the rest of the token's lifetime.
    const pending = vp.status === VisitorPaymentStatus.PENDING_REVIEW;
    const org = pending ? await this.orgRow() : null;
    return {
      status: vp.status,
      amount: Number(vp.amount),
      currency: vp.currency,
      hasProof: !!vp.proofImageKey,
      bank: {
        name: pending ? org?.consultationBankName ?? null : null,
        title: pending ? org?.consultationBankTitle ?? null : null,
        iban: pending ? org?.consultationBankIban ?? null : null,
      },
    };
  }

  /** PUBLIC (token-gated): store the uploaded receipt image on the pending
   *  payment. Finance still verifies it — this only attaches the proof. */
  async uploadConsultProof(token: string, buffer: Buffer, mimeType: string, _filename?: string) {
    const vpId = this.payToken.verify(token);
    if (!vpId) throw new NotFoundException('This link is invalid or has expired.');
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id: vpId } });
    if (!vp) throw new NotFoundException('This link is invalid or has expired.');
    if (vp.status !== VisitorPaymentStatus.PENDING_REVIEW) {
      throw new BadRequestException('This payment has already been handled — no upload is needed.');
    }
    if (!/^image\/(jpe?g|png|webp|heic|heif)$/i.test(mimeType)) {
      throw new BadRequestException('Please upload a photo or screenshot of your receipt (JPG/PNG).');
    }
    // The MIME header is client-supplied and trivially spoofed. Sniff the actual
    // bytes so a mislabelled (or hostile) upload can't land in our bucket dressed
    // as an image and later be served back with an image Content-Type.
    if (!ReceptionService.looksLikeImage(buffer)) {
      throw new BadRequestException('That file does not look like a photo. Please upload a JPG or PNG image.');
    }
    // Deterministic, per-payment key: a re-upload (double-tap, retry, or the
    // customer swapping the image) OVERWRITES the same object in place instead
    // of minting a new one, so concurrent/repeated uploads can never orphan
    // storage. Content-Type is set at upload, so the extension-less key still
    // renders as an image via the signed URL.
    const key = `receipts/consult/${vpId}`;
    await this.storage.uploadAt(key, buffer, mimeType);
    // Only attach the proof if the payment is STILL pending. If finance
    // verified/rejected it in the tiny window since the check above, do NOT
    // stamp the terminal row (a proof is meaningless there) — status-scoped so
    // the write can never resurrect or re-flag a settled payment.
    const res = await this.prisma.visitorPayment.updateMany({
      where: { id: vpId, status: VisitorPaymentStatus.PENDING_REVIEW },
      data: { proofImageKey: key },
    });
    if (res.count === 0) {
      throw new BadRequestException('This payment has already been handled — no upload is needed.');
    }
    // Fire-and-forget an advisory OCR read so finance sees the amount/date/ref
    // parsed off the receipt when they open the queue. Never blocks the
    // customer's upload response, never throws into it.
    void this.runReceiptOcr(vpId, buffer, mimeType);
    return { ok: true as const };
  }

  /**
   * Which reminder (if any) fires for an appointment `minutesUntil` away. Narrow
   * bands around the 2h (≈120 min) and 24h (≈1440 min) marks so a 5-min sweep
   * catches each once (≤2 overlapping ticks; the idempotency key backstops any
   * overlap). Returns null outside both bands. Pure — unit-tested.
   */
  static reminderOffsetFor(minutesUntil: number): '2h' | '24h' | null {
    if (minutesUntil <= 125 && minutesUntil > 110) return '2h';
    if (minutesUntil <= 1445 && minutesUntil > 1420) return '24h';
    return null;
  }

  /** Byte-signature sniff for the image formats we accept. Guards against a
   *  spoofed Content-Type (JPEG / PNG / GIF / WebP-RIFF / HEIC-ISOBMFF-ftyp). */
  private static looksLikeImage(b: Buffer): boolean {
    if (!b || b.length < 12) return false;
    // JPEG: FF D8 FF
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
    // GIF: "GIF8"
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
    // WebP: "RIFF"...."WEBP"
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return true;
    // HEIC/HEIF (ISO-BMFF): bytes 4..8 == "ftyp"
    if (b.toString('ascii', 4, 8) === 'ftyp') return true;
    return false;
  }

  // ── Receipt OCR (P4c): advisory read of the uploaded proof for finance ──────

  /** Status-scoped ocrStatus write; returns rows touched (0 = row not pending). */
  private async setOcrStatus(visitorPaymentId: string, ocrStatus: string): Promise<number> {
    const res = await this.prisma.visitorPayment.updateMany({
      where: { id: visitorPaymentId, status: VisitorPaymentStatus.PENDING_REVIEW },
      data: { ocrStatus },
    });
    return res.count;
  }

  /**
   * Best-effort vision OCR of an uploaded receipt → the advisory ocr* fields on
   * the VisitorPayment. Reuses the admin OpenAI key (the same engine the
   * document parser uses for extraction). Never throws; every DB write is
   * status-scoped to PENDING_REVIEW so a concurrent verify/reject is never
   * clobbered and a settled payment is never re-stamped.
   *
   * Cost-bounded: the read is claimed atomically and ONLY from an unread row
   * (ocrStatus null) or a STALE 'READING' (a prior read that died mid-flight).
   * So the public upload path bills at most ONE vision call per payment no
   * matter how many times a (reusable) token re-uploads, and a distributed set
   * of IPs can't amplify it — the cap lives on the payment row, not the IP.
   * A fresh read on demand goes through the auth-gated {@link reReadReceiptOcr},
   * which resets ocrStatus to null first.
   */
  private async runReceiptOcr(visitorPaymentId: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      // No OpenAI key configured → mark SKIPPED (UI shows nothing), don't error.
      if (!(await this.apiKeys.hasActiveKey('openai'))) {
        await this.setOcrStatus(visitorPaymentId, 'SKIPPED');
        return;
      }
      // Atomic claim: unread (null) OR a stale in-flight read (self-heals a
      // process that died mid-OCR). A concurrent claim on the same row loses
      // (the row is no longer null/stale), so no duplicate billed calls.
      const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
      const claim = await this.prisma.visitorPayment.updateMany({
        where: {
          id: visitorPaymentId,
          status: VisitorPaymentStatus.PENDING_REVIEW,
          OR: [{ ocrStatus: null }, { ocrStatus: 'READING', updatedAt: { lt: staleBefore } }],
        },
        data: { ocrStatus: 'READING' },
      });
      if (claim.count === 0) return; // already read/reading, or settled
      const r = await this.openai.readReceiptImage(buffer, mimeType);
      if (!r) {
        await this.setOcrStatus(visitorPaymentId, 'FAILED');
        return;
      }
      const paidAt = r.paidAt ? new Date(r.paidAt) : null;
      // Clamp the amount to the column's Decimal(12,2) range — an absurd OCR
      // number (garbled/adversarial image) becomes null instead of throwing the
      // whole write and nuking the other correctly-read fields.
      const ocrAmount =
        r.amount != null && Number.isFinite(r.amount) && Math.abs(r.amount) < 1e10
          ? new Prisma.Decimal(r.amount.toFixed(2))
          : null;
      await this.prisma.visitorPayment.updateMany({
        where: { id: visitorPaymentId, status: VisitorPaymentStatus.PENDING_REVIEW },
        data: {
          ocrAmount,
          ocrCurrency: r.currency,
          ocrReference: r.reference,
          ocrBankName: r.bankName,
          ocrPaidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
          ocrRawText: r.rawText,
          ocrConfidence: r.confidence,
          ocrStatus: 'DONE',
        },
      });
    } catch (e) {
      this.log.warn(`receipt OCR error for ${visitorPaymentId}: ${(e as Error).message}`);
      await this.setOcrStatus(visitorPaymentId, 'FAILED').catch(() => undefined);
    }
  }

  /**
   * Finance-triggered re-read of a pending payment's uploaded receipt (the
   * upload-time OCR is fire-and-forget, so this is the retry when it failed or
   * the desk wants a fresh read). Downloads the stored proof and re-runs OCR.
   */
  async reReadReceiptOcr(visitorPaymentId: string): Promise<{ ocrStatus: string }> {
    const vp = await this.prisma.visitorPayment.findUnique({ where: { id: visitorPaymentId } });
    if (!vp) throw new NotFoundException('Payment not found');
    if (vp.status !== VisitorPaymentStatus.PENDING_REVIEW) {
      throw new BadRequestException('Only a pending payment can be re-read.');
    }
    if (!vp.proofImageKey) throw new BadRequestException('No receipt has been uploaded yet.');
    const { bytes, mimeType } = await this.storage.download(vp.proofImageKey);
    // Reset the read state (clears a prior DONE or a stuck 'READING') so the
    // claim in runReceiptOcr always re-runs on this finance-triggered retry.
    await this.prisma.visitorPayment.updateMany({
      where: { id: visitorPaymentId, status: VisitorPaymentStatus.PENDING_REVIEW },
      data: { ocrStatus: null },
    });
    await this.runReceiptOcr(visitorPaymentId, bytes, mimeType ?? 'image/jpeg');
    const after = await this.prisma.visitorPayment.findUnique({
      where: { id: visitorPaymentId },
      select: { ocrStatus: true },
    });
    return { ocrStatus: after?.ocrStatus ?? 'FAILED' };
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
    visit: { name: string; phone: string | null; leadId: string | null; clientId: string | null },
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
          // Link the consult invoice to the SAME lead/client so it lands on their
          // finance customer profile — otherwise the "creditable" fee is orphaned
          // and can never be found or applied against a later service invoice.
          ...(visit.leadId ? { leadId: visit.leadId } : {}),
          ...(visit.clientId ? { clientId: visit.clientId } : {}),
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

  /** First word of a visitor's name, for a WhatsApp greeting ("Hi Ahmed,"). */
  private firstNameOf(name: string | null | undefined): string {
    return (name ?? '').trim().split(/\s+/)[0] || 'there';
  }

  /** A consultation slot as a template-friendly PKT string, e.g.
   *  "28 June 2026, 3:00 PM". */
  private formatSlotPkt(when: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(when)
      .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  }

  /** Fire-and-forget consultation_confirmed after a payment is fully recognised
   *  (cash at desk OR a finance-verified transfer). Best-effort; never throws —
   *  a WhatsApp hiccup must not affect the money result that triggered it. */
  /** Send a payment-related consult template AND persist the delivery outcome on
   *  the VisitorPayment, so finance sees a "not delivered" flag instead of
   *  assuming the customer was told. Best-effort; never throws. */
  private async sendPaymentNotify(
    visitorPaymentId: string,
    input: Parameters<WhatsAppAppointmentNotifierService['sendConsultTemplate']>[0],
  ): Promise<void> {
    let status = 'FAILED';
    try {
      const r = await this.whatsappNotifier.sendConsultTemplate(input);
      status = r.sent ? 'SENT' : r.reason === 'no_consent' || r.reason === 'blocked' ? 'SKIPPED' : 'FAILED';
    } catch (err) {
      this.log.warn(`consult ${input.templateName} notify failed: ${(err as Error).message}`);
    }
    await this.prisma.visitorPayment
      .updateMany({ where: { id: visitorPaymentId }, data: { notifyStatus: status, notifyAt: new Date() } })
      .catch(() => undefined);
  }

  private async notifyConsultConfirmed(vpId: string, visit: {
    id: string;
    name: string;
    phone: string | null;
    leadId: string | null;
    clientId: string | null;
    appointmentId: string | null;
    whatsappConsent: boolean;
  }, amount: number, currency: string, principalEmployeeId: string | null): Promise<void> {
    try {
      const appt = visit.appointmentId
        ? await this.prisma.appointment.findUnique({ where: { id: visit.appointmentId }, select: { scheduledAt: true } })
        : null;
      const principal = principalEmployeeId
        ? await this.prisma.employee.findFirst({ where: { id: principalEmployeeId, deletedAt: null }, select: { firstName: true, lastName: true } })
        : null;
      const principalName = principal ? `${principal.firstName} ${principal.lastName}`.trim() : null;
      const slot = appt ? this.formatSlotPkt(appt.scheduledAt) : 'your booked time';
      const when = principalName ? `${slot} with ${principalName}` : slot;
      await this.sendPaymentNotify(vpId, {
        leadId: visit.leadId,
        clientId: visit.clientId,
        phone: visit.phone,
        templateName: 'consultation_confirmed',
        bodyParams: [this.firstNameOf(visit.name), when, `${currency} ${amount.toLocaleString()}`],
        idempotencyKey: `consult-confirmed-${visit.id}`,
        consent: visit.whatsappConsent,
      });
    } catch (err) {
      this.log.warn(`consult confirmed notify failed: ${(err as Error).message}`);
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
