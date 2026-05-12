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
      // Candidate records — module not yet built, surfaced as 0 so the
      // dashboard widget renders the placeholder without a runtime error.
      candidateRecords: 0,
      topAgents,
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