import { Injectable } from '@nestjs/common';
import { AppointmentStatus, AuditAction, CaseStatus, DocumentStatus, InvoiceStatus, LeadStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardSummary() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const [
      totalLeads,
      newLeads,
      leadsToday,
      activeClients,
      openCases,
      pendingDocuments,
      activeEmployees,
      overdueInvoices,
      appointmentsToday,
      auditEventsToday,
    ] = await this.prisma.$transaction([
      this.prisma.lead.count({ where: { deletedAt: null } }),
      this.prisma.lead.count({ where: { deletedAt: null, status: LeadStatus.NEW } }),
      this.prisma.lead.count({
        where: { deletedAt: null, createdAt: { gte: todayStart, lt: tomorrowStart } },
      }),
      this.prisma.client.count({ where: { deletedAt: null } }),
      this.prisma.case.count({
        where: { deletedAt: null, status: { in: [CaseStatus.OPEN, CaseStatus.IN_PROGRESS, CaseStatus.DOCUMENTATION, CaseStatus.PROCESSING, CaseStatus.SUBMITTED, CaseStatus.ON_HOLD] } },
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
      this.prisma.auditLog.count({ where: { createdAt: { gte: todayStart, lt: tomorrowStart } } }),
    ]);

    return {
      totalLeads,
      newLeads,
      leadsToday,
      activeClients,
      openCases,
      pendingDocuments,
      activeEmployees,
      overdueInvoices,
      appointmentsToday,
      auditEventsToday,
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