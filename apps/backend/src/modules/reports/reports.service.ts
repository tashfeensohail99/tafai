import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  AuditAction,
  CaseStatus,
  DocumentStatus,
  FollowUpStatus,
  InvoiceStatus,
  LeadStatus,
  PaymentStatus,
  ProcessingCaseStage,
  WhatsAppMessageDirection,
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardSummary() {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const monthStart = new Date(todayStart);
    monthStart.setDate(1);

    // Single $transaction keeps every count consistent with the same snapshot
    // and minimises round-trips against the pooled Supabase connection.
    const [
      totalLeads,
      newLeadsStatus,
      leadsToday,
      assignedLeads,
      unassignedLeads,
      activeClients,
      openCases,
      pendingProcessingCases,
      pendingDocuments,
      activeEmployees,
      overdueInvoices,
      appointmentsToday,
      overdueFollowUps,
      auditEventsToday,
      activeWhatsAppThreads,
      whatsappUnassigned,
      paymentsToday,
      paymentsThisMonth,
    ] = await this.prisma.$transaction([
      this.prisma.lead.count({ where: { deletedAt: null } }),
      this.prisma.lead.count({ where: { deletedAt: null, status: LeadStatus.NEW } }),
      this.prisma.lead.count({
        where: { deletedAt: null, createdAt: { gte: todayStart, lt: tomorrowStart } },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, assignedEmployeeId: { not: null } },
      }),
      this.prisma.lead.count({
        where: { deletedAt: null, assignedEmployeeId: null },
      }),
      this.prisma.client.count({ where: { deletedAt: null } }),
      this.prisma.case.count({
        where: { deletedAt: null, status: { in: [CaseStatus.OPEN, CaseStatus.IN_PROGRESS, CaseStatus.DOCUMENTATION, CaseStatus.PROCESSING, CaseStatus.SUBMITTED, CaseStatus.ON_HOLD] } },
      }),
      this.prisma.processingCase.count({
        where: {
          stage: { notIn: [ProcessingCaseStage.COMPLETED, ProcessingCaseStage.CANCELLED] },
          cancelledAt: null,
        },
      }),
      this.prisma.clientDocument.count({
        where: {
          status: { in: [DocumentStatus.PENDING, DocumentStatus.UNDER_REVIEW, DocumentStatus.REPLACEMENT_REQUIRED] },
        },
      }),
      this.prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.invoice.count({ where: { status: InvoiceStatus.OVERDUE } }),
      this.prisma.appointment.count({
        where: {
          scheduledAt: { gte: todayStart, lt: tomorrowStart },
          status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        },
      }),
      this.prisma.followUp.count({
        where: { status: FollowUpStatus.OPEN, dueAt: { lt: now } },
      }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: todayStart, lt: tomorrowStart } } }),
      this.prisma.whatsAppThread.count({
        where: { status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] } },
      }),
      this.prisma.whatsAppThread.count({
        where: {
          status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
          lead: { assignedEmployeeId: null },
        },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
          verifiedAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
          verifiedAt: { gte: monthStart },
        },
      }),
    ]);

    // Sales team performance — top 5 agents by lead count (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const topAgentsRaw = await this.prisma.lead.groupBy({
      by: ['assignedEmployeeId'],
      where: {
        deletedAt: null,
        assignedEmployeeId: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { _all: true },
      orderBy: { _count: { assignedEmployeeId: 'desc' } },
      take: 5,
    });
    const employees = topAgentsRaw.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: topAgentsRaw.map((r) => r.assignedEmployeeId!) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const topAgents = topAgentsRaw.map((r) => {
      const e = employeeById.get(r.assignedEmployeeId!);
      return {
        employeeId: r.assignedEmployeeId,
        name: e ? `${e.firstName} ${e.lastName}`.trim() : 'Unknown',
        leadCount: r._count._all,
      };
    });

    return {
      // Legacy fields — keep so existing UI doesn't break.
      totalLeads,
      newLeads: newLeadsStatus,
      leadsToday,
      activeClients,
      openCases,
      pendingDocuments,
      activeEmployees,
      overdueInvoices,
      appointmentsToday,
      auditEventsToday,
      // New widgets per the admin spec.
      assignedLeads,
      unassignedLeads,
      activeWhatsAppThreads,
      whatsappUnassigned,
      pendingProcessingCases,
      overdueFollowUps,
      paymentsTodayAmount: Number(paymentsToday._sum.amount ?? 0),
      paymentsThisMonthAmount: Number(paymentsThisMonth._sum.amount ?? 0),
      topAgents,
    };
  }

  /**
   * Per-agent sales KPIs for the admin sales overview. Returns top-line
   * totals plus one row per active employee with their assigned-lead count,
   * recent activity, and a 30-day conversion rate.
   *
   * Scoped to employees regardless of WhatsApp inbox membership — sales
   * managers want to see everyone they're responsible for, not just the
   * WhatsApp roster.
   */
  async getSalesOverview() {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(todayStart);
    monthStart.setDate(1);
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      activeAgents,
      totalLeads,
      convertedThisMonth,
      overdueFollowUps,
      appointmentsToday,
      employees,
      assignedCounts,
      newLeadCounts,
      convertedCounts,
      openFollowUpCounts,
      overdueFollowUpCounts,
      upcomingApptCounts,
      awaitingReplyThreads,
    ] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.lead.count({ where: { deletedAt: null } }),
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          status: LeadStatus.CONVERTED,
          convertedAt: { gte: monthStart },
        },
      }),
      this.prisma.followUp.count({
        where: { status: FollowUpStatus.OPEN, dueAt: { lt: now } },
      }),
      this.prisma.appointment.count({
        where: {
          scheduledAt: { gte: todayStart, lt: tomorrowStart },
          status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        },
      }),
      this.prisma.employee.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          whatsappInboxMember: true,
          presenceStatus: true,
          lastActivityAt: true,
          slaResponsesMet: true,
          slaResponsesBreached: true,
        },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.lead.groupBy({
        by: ['assignedEmployeeId'],
        where: { deletedAt: null, assignedEmployeeId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['assignedEmployeeId'],
        where: {
          deletedAt: null,
          assignedEmployeeId: { not: null },
          createdAt: { gte: thirtyDaysAgo },
        },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['assignedEmployeeId'],
        where: {
          deletedAt: null,
          assignedEmployeeId: { not: null },
          status: LeadStatus.CONVERTED,
          convertedAt: { gte: thirtyDaysAgo },
        },
        _count: { _all: true },
      }),
      this.prisma.followUp.groupBy({
        by: ['assignedEmployeeId'],
        where: { status: FollowUpStatus.OPEN, assignedEmployeeId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.followUp.groupBy({
        by: ['assignedEmployeeId'],
        where: {
          status: FollowUpStatus.OPEN,
          dueAt: { lt: now },
          assignedEmployeeId: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.appointment.groupBy({
        by: ['assignedEmployeeId'],
        where: {
          assignedEmployeeId: { not: null },
          scheduledAt: { gte: now, lt: weekEnd },
          status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        },
        _count: { _all: true },
      }),
      // Conversations the *human* rep hasn't personally replied to: the client
      // has texted (>=1 inbound) but every outbound so far is the AI bot
      // (sentByEmployeeId NULL) or there's no reply at all. Bot replies do NOT
      // count as the rep replying — this catches reps letting the bot carry the
      // chat without ever typing a word. Scoped to active threads whose lead is
      // assigned to a (non-deleted) rep, so we can group by salesperson.
      this.prisma.whatsAppThread.findMany({
        where: {
          status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
          lead: { assignedEmployeeId: { not: null }, deletedAt: null },
          AND: [
            { messages: { some: { direction: WhatsAppMessageDirection.INBOUND } } },
            {
              messages: {
                none: {
                  direction: WhatsAppMessageDirection.OUTBOUND,
                  sentByEmployeeId: { not: null },
                },
              },
            },
          ],
        },
        select: { lead: { select: { assignedEmployeeId: true } } },
      }),
    ]);

    // Build per-employeeId lookup tables once.
    const idx = <T extends { assignedEmployeeId: string | null; _count: { _all: number } }>(
      rows: T[],
    ) => new Map(rows.filter((r) => r.assignedEmployeeId).map((r) => [r.assignedEmployeeId!, r._count._all]));
    const assignedMap = idx(assignedCounts);
    const newMap = idx(newLeadCounts);
    const convertedMap = idx(convertedCounts);
    const openFollowUpMap = idx(openFollowUpCounts);
    const overdueFollowUpMap = idx(overdueFollowUpCounts);
    const upcomingApptMap = idx(upcomingApptCounts);
    // Awaiting-reply threads grouped by the assigned rep (relation field, so
    // a plain groupBy can't do it — tally in JS; the backlog is small).
    const awaitingReplyMap = new Map<string, number>();
    for (const t of awaitingReplyThreads) {
      const aid = t.lead?.assignedEmployeeId;
      if (aid) awaitingReplyMap.set(aid, (awaitingReplyMap.get(aid) ?? 0) + 1);
    }

    const agents = employees.map((e) => {
      const newLeads = newMap.get(e.id) ?? 0;
      const converted = convertedMap.get(e.id) ?? 0;
      // Response-SLA score: on-time replies / total replies × 100. No history
      // → 100, so every agent starts at the max and works to keep it.
      const slaTotal = e.slaResponsesMet + e.slaResponsesBreached;
      const slaScore = slaTotal === 0 ? 100 : Math.round((e.slaResponsesMet / slaTotal) * 100);
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        avatarInitials: ((e.firstName[0] ?? '') + (e.lastName[0] ?? '')).toUpperCase(),
        whatsappInboxMember: e.whatsappInboxMember,
        presenceStatus: e.presenceStatus,
        lastActivityAt: e.lastActivityAt,
        assignedLeads: assignedMap.get(e.id) ?? 0,
        newLeadsLast30d: newLeads,
        converted30d: converted,
        conversionRate: newLeads > 0 ? converted / newLeads : 0,
        openFollowUps: openFollowUpMap.get(e.id) ?? 0,
        overdueFollowUps: overdueFollowUpMap.get(e.id) ?? 0,
        upcomingAppointments: upcomingApptMap.get(e.id) ?? 0,
        awaitingReply: awaitingReplyMap.get(e.id) ?? 0,
        slaScore,
        slaBreaches: e.slaResponsesBreached,
      };
    });

    return {
      totals: {
        activeAgents,
        totalLeads,
        convertedThisMonth,
        overdueFollowUps,
        appointmentsToday,
        awaitingReply: awaitingReplyThreads.length,
      },
      agents,
    };
  }

  async getWorkflowBoard() {
    const [salesQueue, financeQueue, processingQueue, pendingDocuments, handoverHistory] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.PROPOSAL_SENT, LeadStatus.FOLLOW_UP] },
          convertedClientId: null,
        },
        include: {
          assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { appointments: true, invoices: true, timelineEvents: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.PENDING },
        include: {
          invoice: {
            include: {
              lead: { select: { id: true, firstName: true, lastName: true, phone: true, serviceInterest: true, targetCountry: true } },
              client: { select: { id: true, firstName: true, lastName: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
      this.prisma.case.findMany({
        where: {
          deletedAt: null,
          status: { in: [CaseStatus.DOCUMENTATION, CaseStatus.PROCESSING, CaseStatus.IN_PROGRESS, CaseStatus.ON_HOLD] },
        },
        include: {
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          department: { select: { id: true, name: true } },
          assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { documents: true, appointments: true, timelineEvents: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.clientDocument.findMany({
        where: {
          status: { in: [DocumentStatus.PENDING, DocumentStatus.UPLOADED, DocumentStatus.UNDER_REVIEW, DocumentStatus.REPLACEMENT_REQUIRED] },
        },
        include: {
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          case: { select: { id: true, caseNumber: true, status: true } },
          documentRequirement: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: { in: [AuditAction.LEAD_ASSIGNED, AuditAction.LEAD_CONVERTED, AuditAction.PAYMENT_VERIFIED, AuditAction.CASE_HANDOVER] },
        },
        include: {
          actor: { select: { id: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      salesQueue,
      financeQueue,
      processingQueue,
      pendingDocuments,
      handoverHistory,
    };
  }
}