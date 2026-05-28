import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CommunicationDirection,
  CommunicationMessageType,
  DocumentItemStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentAiService } from '../processing/document-ai/document-ai.service';
import { RequestUser } from '../../common/types/auth.types';
import { PortalSendMessageDto } from './portal.dto';
import { describeRejections } from './rejection-messages';

// ---- Notification feed types -----------------------------------------------
// Declared at module scope (not inside getNotifications) so the controller
// can re-export the return shape without TypeScript complaining about
// "private name from external module".
export type PortalNotificationKind =
  | 'UNREAD_MESSAGE'
  | 'MISSING_DOCUMENT'
  | 'REJECTED_DOCUMENT'
  | 'EXPIRING_DOCUMENT'
  | 'UPCOMING_APPOINTMENT'
  | 'STAGE_CHANGE';

export interface PortalNotification {
  id: string;
  kind: PortalNotificationKind;
  title: string;
  body: string;
  createdAt: Date;
  caseId: string | null;
  severity: 'info' | 'warning' | 'danger' | 'success';
  href: string;
}

// Accepted MIME types for document uploads
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
]);

// 10 MB hard cap — matches document item default
const MAX_FILE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    // Phase D3 — client portal uploads get the same AI assessment + guarded
    // auto-approve as officer/WhatsApp uploads.
    private readonly documentAi: DocumentAiService,
  ) {}

  // -------------------------------------------------------------------------
  // OWNERSHIP HELPERS
  // -------------------------------------------------------------------------

  /**
   * Resolve the Client record linked to the authenticated user account.
   * We match on email, since UserAccount and Client share a unique email.
   * Throws ForbiddenException if no Client record exists for this user.
   */
  private async resolveClientId(user: RequestUser): Promise<string> {
    const client = await this.prisma.client.findUnique({
      where: { email: user.email },
      select: { id: true, portalAccessEnabled: true, status: true },
    });
    if (!client) {
      throw new ForbiddenException('No client record associated with this account');
    }
    if (!client.portalAccessEnabled) {
      throw new ForbiddenException('Client portal access is not enabled for this account');
    }
    if (client.status !== 'ACTIVE') {
      throw new ForbiddenException('Client account is not active');
    }
    return client.id;
  }

  /**
   * Assert the given case belongs to the given client.
   * Returns the case record on success.
   */
  private async assertCaseOwnership(caseId: string, clientId: string) {
    const processingCase = await this.prisma.processingCase.findFirst({
      where: { id: caseId, clientId },
      select: {
        id: true,
        stage: true,
        priority: true,
        service: true,
        targetCountry: true,
        createdAt: true,
        slaDueAt: true,
        clientId: true,
        assignedOfficer: {
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
        financeHandover: {
          select: { createdAt: true },
        },
      },
    });
    if (!processingCase) {
      throw new NotFoundException('Case not found');
    }
    return processingCase;
  }

  // -------------------------------------------------------------------------
  // CASE
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/mine
   * Returns the client's active processing cases (typically one).
   * Never exposes other clients' data — always filtered by clientId.
   */
  async getMyCases(user: RequestUser) {
    const clientId = await this.resolveClientId(user);

    const cases = await this.prisma.processingCase.findMany({
      where: {
        clientId,
        cancelledAt: null,
      },
      select: {
        id: true,
        stage: true,
        priority: true,
        service: true,
        targetCountry: true,
        createdAt: true,
        slaDueAt: true,
        assignedOfficer: {
          select: {
            employee: { select: { firstName: true, lastName: true } },
          },
        },
        documentItems: {
          select: {
            status: true,
            criticality: true,
          },
        },
        communications: {
          where: {
            direction: CommunicationDirection.OFFICER_TO_CLIENT,
            readByClientAt: null,
          },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return cases.map((c) => {
      const totalDocs = c.documentItems.length;
      const acceptedDocs = c.documentItems.filter((d) => d.status === 'ACCEPTED').length;
      const actionRequired = c.documentItems.filter(
        (d) => d.status === 'NOT_SUBMITTED' || d.status === 'REJECTED',
      ).length;

      return {
        id: c.id,
        stage: c.stage,
        service: c.service,
        targetCountry: c.targetCountry,
        createdAt: c.createdAt,
        slaDueAt: c.slaDueAt,
        assignedOfficerName: c.assignedOfficer?.employee
          ? `${c.assignedOfficer.employee.firstName} ${c.assignedOfficer.employee.lastName}`.trim()
          : null,
        docsTotal: totalDocs,
        docsAccepted: acceptedDocs,
        docsActionRequired: actionRequired,
        unreadMessages: c.communications.length,
      };
    });
  }

  /**
   * GET /portal/cases/:caseId
   * Single case detail.
   */
  async getCaseDetail(caseId: string, user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    const c = await this.assertCaseOwnership(caseId, clientId);

    const docCounts = await this.prisma.caseDocumentItem.groupBy({
      by: ['status'],
      where: { caseId },
      _count: { id: true },
    });
    const countMap: Record<string, number> = {};
    for (const row of docCounts) {
      countMap[row.status] = row._count.id;
    }

    const unreadCount = await this.prisma.caseCommunication.count({
      where: {
        caseId,
        direction: CommunicationDirection.OFFICER_TO_CLIENT,
        readByClientAt: null,
      },
    });

    return {
      id: c.id,
      stage: c.stage,
      service: c.service,
      targetCountry: c.targetCountry,
      createdAt: c.createdAt,
      slaDueAt: c.slaDueAt,
      assignedOfficerName: c.assignedOfficer?.employee
        ? `${c.assignedOfficer.employee.firstName} ${c.assignedOfficer.employee.lastName}`.trim()
        : null,
      docCounts: countMap,
      unreadMessages: unreadCount,
    };
  }

  // -------------------------------------------------------------------------
  // DOCUMENTS
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/:caseId/documents
   * Filtered checklist — no internal officer strategy notes. Client sees:
   * - documentName, description, criticality, status
   * - expectedFormats, maxFileSizeMb
   * - latestVersion (upload info)
   * - client-visible rejection reasons from latest review decision
   * NOT exposed: reviewedBy user, officer's private reviewNote
   */
  async getDocumentChecklist(caseId: string, user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    await this.assertCaseOwnership(caseId, clientId);

    const items = await this.prisma.caseDocumentItem.findMany({
      where: { caseId },
      select: {
        id: true,
        documentName: true,
        description: true,
        criticality: true,
        status: true,
        expectedFormats: true,
        maxFileSizeMb: true,
        validityExpiryDate: true,
        requestDeadline: true,
        latestVersion: {
          select: {
            id: true,
            fileName: true,
            fileSizeBytes: true,
            mimeType: true,
            versionNumber: true,
            uploadedAt: true,
            // storageKey is NEVER sent to the client — access only via signed-url endpoint
          },
        },
        reviewDecisions: {
          where: {
            decision: 'REJECTED',
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            decision: true,
            rejectionReasonCodes: true,
            // rejectionNote (officer's private note) is NOT selected
          },
        },
      },
      orderBy: [{ criticality: 'asc' }, { sortOrder: 'asc' }],
    });

    return items.map((item) => {
      const rawCodes = item.reviewDecisions[0]?.rejectionReasonCodes ?? [];
      return {
        ...item,
        canUpload: item.status === 'NOT_SUBMITTED' || item.status === 'REJECTED',
        latestRejectionReasonCodes: rawCodes,
        // Backend-translated friendly messages — frontend renders these only
        // so internal codes never leak into client-facing UI.
        latestRejectionMessages: describeRejections(rawCodes),
        reviewDecisions: undefined, // strip the raw relation
      };
    });
  }

  /**
   * POST /portal/cases/:caseId/documents/:itemId/upload
   * Client uploads a document version.
   * - Validates ownership, file type, file size
   * - Stores via private S3-compatible storage (never a public URL)
   * - Creates ClientDocumentVersion record
   * - Updates CaseDocumentItem.latestVersionId + status = SUBMITTED
   * - Logs the upload action
   */
  async uploadDocument(
    caseId: string,
    itemId: string,
    file: Express.Multer.File,
    user: RequestUser,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
    const clientId = await this.resolveClientId(user);
    await this.assertCaseOwnership(caseId, clientId);

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      select: {
        id: true,
        status: true,
        documentName: true,
        maxFileSizeMb: true,
        expectedFormats: true,
        versions: { select: { id: true }, orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });
    if (!item) throw new NotFoundException('Document item not found');

    // Only allow upload on NOT_SUBMITTED or REJECTED items
    if (item.status !== 'NOT_SUBMITTED' && item.status !== 'REJECTED') {
      throw new BadRequestException(
        `Cannot upload a document with status '${item.status}'. Only NOT_SUBMITTED or REJECTED items can be re-uploaded.`,
      );
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' is not accepted. Allowed: PDF, JPG, PNG, HEIC.`,
      );
    }

    // Validate file size (use item-specific limit or hard cap)
    const maxBytes = Math.min(item.maxFileSizeMb * 1024 * 1024, MAX_FILE_BYTES);
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `File too large. Maximum size for this document is ${item.maxFileSizeMb} MB.`,
      );
    }

    // Calculate new version number
    const prevVersionNumber = item.versions[0] ? (item.versions.length) : 0;
    const newVersionNumber = prevVersionNumber + 1;

    // Upload to private storage — folder scoped to caseId/itemId for easy audit
    const uploadResult = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `processing/cases/${caseId}/documents/${itemId}`,
      file.originalname,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // Create version record
      const version = await tx.clientDocumentVersion.create({
        data: {
          documentItemId: itemId,
          caseId,
          clientId,
          storageKey: uploadResult.key,
          fileName: file.originalname,
          fileSizeBytes: file.size,
          mimeType: file.mimetype,
          versionNumber: newVersionNumber,
          uploadedByUserId: user.id,
          isCurrent: true,
        },
      });

      // Mark previous versions as not current
      await tx.clientDocumentVersion.updateMany({
        where: { documentItemId: itemId, id: { not: version.id } },
        data: { isCurrent: false },
      });

      // Update document item: latestVersionId + status → SUBMITTED
      await tx.caseDocumentItem.update({
        where: { id: itemId },
        data: {
          latestVersionId: version.id,
          status: DocumentItemStatus.SUBMITTED,
          updatedAt: new Date(),
        },
      });

      // Audit log
      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'client_document_uploaded',
          entityType: 'case_document_item',
          entityId: itemId,
          oldValues: { status: item.status },
          newValues: {
            status: DocumentItemStatus.SUBMITTED,
            versionNumber: newVersionNumber,
            fileName: file.originalname,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return {
        id: version.id,
        documentItemId: itemId,
        versionNumber: newVersionNumber,
        fileName: file.originalname,
        fileSizeBytes: file.size,
        uploadedAt: version.uploadedAt,
        status: DocumentItemStatus.SUBMITTED,
      };
    });

    // Run the AI assessment (OCR + ownership/type/completeness, possible
    // guarded auto-approve) — same pipeline as officer + WhatsApp uploads.
    void this.documentAi.enqueue(result.id);

    return result;
  }

  /**
   * GET /portal/cases/:caseId/documents/:itemId/signed-url
   * Issue a short-lived signed URL for the client to view their own document.
   * Access is logged. storageKey is NEVER sent to the client.
   */
  async getDocumentSignedUrl(
    caseId: string,
    itemId: string,
    user: RequestUser,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
    const clientId = await this.resolveClientId(user);
    await this.assertCaseOwnership(caseId, clientId);

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      select: {
        latestVersion: { select: { id: true, storageKey: true, fileName: true } },
      },
    });
    if (!item) throw new NotFoundException('Document item not found');
    if (!item.latestVersion) {
      throw new BadRequestException('No uploaded document found for this item');
    }

    const url = await this.storage.getSignedUrl(item.latestVersion.storageKey);

    // Log access for audit
    await this.prisma.documentAccessLog.create({
      data: {
        documentVersionId: item.latestVersion.id,
        accessedByUserId: user.id,
        accessType: 'VIEW',
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    return { url, fileName: item.latestVersion.fileName };
  }

  // -------------------------------------------------------------------------
  // COMMUNICATIONS
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/:caseId/communications
   * Filtered — only OFFICER_TO_CLIENT, CLIENT_TO_OFFICER, SYSTEM_TO_CLIENT.
   * Internal officer messages are excluded.
   * Also marks unread OFFICER_TO_CLIENT messages as read.
   */
  async getCommunications(caseId: string, user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    await this.assertCaseOwnership(caseId, clientId);

    const messages = await this.prisma.caseCommunication.findMany({
      where: {
        caseId,
        direction: {
          in: [
            CommunicationDirection.OFFICER_TO_CLIENT,
            CommunicationDirection.CLIENT_TO_OFFICER,
            CommunicationDirection.SYSTEM_TO_CLIENT,
          ],
        },
      },
      select: {
        id: true,
        direction: true,
        messageType: true,
        subject: true,
        content: true,
        channelsSent: true,
        createdAt: true,
        readByClientAt: true,
        sentBy: {
          select: {
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Mark unread officer messages as read (batch update, non-critical)
    const unreadIds = messages
      .filter((m) => m.direction === 'OFFICER_TO_CLIENT' && !m.readByClientAt)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      await this.prisma.caseCommunication.updateMany({
        where: { id: { in: unreadIds } },
        data: { readByClientAt: new Date() },
      });
    }

    return messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      messageType: m.messageType,
      subject: m.subject,
      content: m.content,
      channelsSent: m.channelsSent,
      createdAt: m.createdAt,
      readByClientAt: m.readByClientAt,
      senderName: m.sentBy?.employee
        ? `${m.sentBy.employee.firstName} ${m.sentBy.employee.lastName}`.trim()
        : null,
    }));
  }

  /**
   * POST /portal/cases/:caseId/communications
   * Client sends a reply to their officer.
   */
  async sendMessage(caseId: string, dto: PortalSendMessageDto, user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    await this.assertCaseOwnership(caseId, clientId);

    const message = await this.prisma.caseCommunication.create({
      data: {
        caseId,
        direction: CommunicationDirection.CLIENT_TO_OFFICER,
        messageType: CommunicationMessageType.GENERAL_UPDATE,
        subject: dto.subject ?? 'Message from client',
        content: dto.content,
        channelsSent: ['PORTAL'],
        sentByUserId: user.id,
      },
      select: {
        id: true,
        direction: true,
        subject: true,
        content: true,
        createdAt: true,
      },
    });

    // Audit log
    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'client_message_sent',
        entityType: 'case_communication',
        entityId: message.id,
        newValues: { direction: 'CLIENT_TO_OFFICER', subject: dto.subject },
      },
    });

    return message;
  }

  // -------------------------------------------------------------------------
  // TIMELINE
  // -------------------------------------------------------------------------

  /**
   * GET /portal/cases/:caseId/timeline
   * Filtered timeline for the client:
   * - Stage history (all, readable labels)
   * - Document review decisions (accepted/rejected — no internal officer note)
   * - OFFICER_TO_CLIENT and SYSTEM_TO_CLIENT communications (not CLIENT_TO_OFFICER)
   * NOT included: ProcessingNote records, tasks, internal audit items
   */
  async getTimeline(caseId: string, user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    await this.assertCaseOwnership(caseId, clientId);

    const [stageHistory, reviewDecisions, communications] = await Promise.all([
      this.prisma.processingCaseStageHistory.findMany({
        where: { caseId },
        select: {
          id: true,
          fromStage: true,
          toStage: true,
          reason: true,
          createdAt: true,
          changedBy: {
            select: { employee: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),

      this.prisma.documentReviewDecision.findMany({
        where: { documentItem: { caseId } },
        select: {
          id: true,
          decision: true,
          rejectionReasonCodes: true,
          // rejectionNote (officer's private note) NOT selected
          createdAt: true,
          documentItem: { select: { documentName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),

      this.prisma.caseCommunication.findMany({
        where: {
          caseId,
          direction: {
            in: [
              CommunicationDirection.OFFICER_TO_CLIENT,
              CommunicationDirection.SYSTEM_TO_CLIENT,
            ],
          },
        },
        select: {
          id: true,
          direction: true,
          messageType: true,
          subject: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Merge and sort all events by createdAt
    type TimelineEvent = {
      id: string;
      type: 'STAGE_CHANGE' | 'DOCUMENT_REVIEW' | 'COMMUNICATION';
      createdAt: Date;
      description: string;
      actor: string | null;
    };

    const events: TimelineEvent[] = [
      ...stageHistory.map((s) => ({
        id: s.id,
        type: 'STAGE_CHANGE' as const,
        createdAt: s.createdAt,
        description: s.reason ?? `Stage changed to ${s.toStage.replace(/_/g, ' ')}`,
        actor: s.changedBy.employee
          ? `${s.changedBy.employee.firstName} ${s.changedBy.employee.lastName}`.trim()
          : null,
      })),

      ...reviewDecisions.map((r) => ({
        id: r.id,
        type: 'DOCUMENT_REVIEW' as const,
        createdAt: r.createdAt,
        description:
          r.decision === 'ACCEPTED'
            ? `Document accepted: ${r.documentItem.documentName}`
            : `Document requires correction: ${r.documentItem.documentName}`,
        actor: null, // officer identity not exposed to client
        decision: r.decision,
        rejectionReasonCodes: r.rejectionReasonCodes,
      })),

      ...communications.map((c) => ({
        id: c.id,
        type: 'COMMUNICATION' as const,
        createdAt: c.createdAt,
        description: c.subject ?? c.messageType.replace(/_/g, ' ').toLowerCase(),
        actor: null,
      })),
    ];

    events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return events;
  }

  // -------------------------------------------------------------------------
  // APPOINTMENTS
  // -------------------------------------------------------------------------

  /**
   * GET /portal/appointments
   * Every appointment for this client. Read-only — clients can't schedule
   * from the portal in Phase 1. Returns past + upcoming so the page can
   * group them.
   */
  async getAppointments(user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    const rows = await this.prisma.appointment.findMany({
      where: { clientId },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        title: true,
        appointmentType: true,
        scheduledAt: true,
        durationMinutes: true,
        location: true,
        meetingLink: true,
        notes: true,
        status: true,
        reminderSentAt: true,
        completedAt: true,
        cancellationReason: true,
      },
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      appointmentType: a.appointmentType,
      scheduledAt: a.scheduledAt,
      durationMinutes: a.durationMinutes,
      location: a.location,
      meetingLink: a.meetingLink,
      instructions: a.notes,
      status: a.status,
      reminderSent: a.reminderSentAt !== null,
      completedAt: a.completedAt,
      cancellationReason: a.cancellationReason,
    }));
  }

  // -------------------------------------------------------------------------
  // NOTIFICATIONS (derived)
  // -------------------------------------------------------------------------

  /**
   * GET /portal/notifications
   * Aggregates several existing signals into a single feed:
   *  - unread officer messages
   *  - missing documents
   *  - rejected documents
   *  - documents expiring within 60 days (or already expired)
   *  - upcoming appointments (next 30 days)
   *  - recent stage changes (last 14 days)
   *
   * No persistence layer yet — we'll upgrade to a real ClientNotification
   * table when we want push / read-state across devices. For now, the UI
   * recomputes on each visit.
   */
  async getNotifications(user: RequestUser): Promise<PortalNotification[]> {
    const clientId = await this.resolveClientId(user);
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const cases = await this.prisma.processingCase.findMany({
      where: { clientId, cancelledAt: null },
      select: { id: true, service: true, targetCountry: true },
    });
    const caseIds = cases.map((c) => c.id);

    const [unreadMessages, missingDocs, rejectedDocs, expiringDocs, upcomingAppts, recentStages] =
      await Promise.all([
        this.prisma.caseCommunication.findMany({
          where: {
            caseId: { in: caseIds },
            direction: CommunicationDirection.OFFICER_TO_CLIENT,
            readByClientAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, caseId: true, subject: true, createdAt: true },
        }),
        this.prisma.caseDocumentItem.findMany({
          where: { caseId: { in: caseIds }, status: DocumentItemStatus.NOT_SUBMITTED },
          select: { id: true, caseId: true, documentName: true, requestDeadline: true },
        }),
        this.prisma.caseDocumentItem.findMany({
          where: {
            caseId: { in: caseIds },
            status: DocumentItemStatus.REJECTED,
          },
          select: { id: true, caseId: true, documentName: true, updatedAt: true },
        }),
        this.prisma.caseDocumentItem.findMany({
          where: {
            caseId: { in: caseIds },
            validityExpiryDate: { not: null, lte: in60Days },
            status: { notIn: [DocumentItemStatus.WAIVED] },
          },
          select: { id: true, caseId: true, documentName: true, validityExpiryDate: true },
        }),
        this.prisma.appointment.findMany({
          where: {
            clientId,
            scheduledAt: { gte: now, lte: in30Days },
            status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 10,
          select: {
            id: true,
            title: true,
            appointmentType: true,
            scheduledAt: true,
            location: true,
          },
        }),
        this.prisma.processingCaseStageHistory.findMany({
          where: { caseId: { in: caseIds }, createdAt: { gte: fourteenDaysAgo } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, caseId: true, toStage: true, createdAt: true },
        }),
      ]);

    const out: PortalNotification[] = [];

    for (const m of unreadMessages) {
      out.push({
        id: `msg-${m.id}`,
        kind: 'UNREAD_MESSAGE',
        title: 'New message from your officer',
        body: m.subject ?? 'Open the messages tab to read it.',
        createdAt: m.createdAt,
        caseId: m.caseId,
        severity: 'info',
        href: '/portal/case/messages',
      });
    }

    for (const d of missingDocs) {
      out.push({
        id: `miss-${d.id}`,
        kind: 'MISSING_DOCUMENT',
        title: `Please upload: ${d.documentName}`,
        body: d.requestDeadline
          ? `Deadline: ${d.requestDeadline.toISOString().slice(0, 10)}`
          : 'This document is required to move your case forward.',
        createdAt: now,
        caseId: d.caseId,
        severity: 'warning',
        href: '/portal/case/documents',
      });
    }

    for (const d of rejectedDocs) {
      out.push({
        id: `rej-${d.id}`,
        kind: 'REJECTED_DOCUMENT',
        title: `Re-upload required: ${d.documentName}`,
        body: 'See the documents tab for the correction reason and re-upload a fresh copy.',
        createdAt: d.updatedAt,
        caseId: d.caseId,
        severity: 'danger',
        href: '/portal/case/documents',
      });
    }

    for (const d of expiringDocs) {
      const expiry = d.validityExpiryDate!;
      const expired = expiry.getTime() < now.getTime();
      out.push({
        id: `exp-${d.id}`,
        kind: 'EXPIRING_DOCUMENT',
        title: expired
          ? `${d.documentName} has expired`
          : `${d.documentName} expires on ${expiry.toISOString().slice(0, 10)}`,
        body: expired
          ? 'Please upload a renewed copy as soon as possible.'
          : 'Please upload a renewed copy before submission.',
        createdAt: now,
        caseId: d.caseId,
        severity: expired ? 'danger' : 'warning',
        href: '/portal/case/documents',
      });
    }

    for (const a of upcomingAppts) {
      out.push({
        id: `appt-${a.id}`,
        kind: 'UPCOMING_APPOINTMENT',
        title: a.title,
        body: `${a.appointmentType.replace(/_/g, ' ').toLowerCase()} on ${a.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}${a.location ? ` — ${a.location}` : ''}`,
        createdAt: a.scheduledAt,
        caseId: null,
        severity: 'info',
        href: '/portal/case/appointments',
      });
    }

    for (const s of recentStages) {
      out.push({
        id: `stage-${s.id}`,
        kind: 'STAGE_CHANGE',
        title: `Case moved to ${s.toStage.replace(/_/g, ' ').toLowerCase()}`,
        body: 'See the case timeline for details.',
        createdAt: s.createdAt,
        caseId: s.caseId,
        severity: 'success',
        href: '/portal/case/timeline',
      });
    }

    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return out;
  }

  // -------------------------------------------------------------------------
  // PROFILE
  // -------------------------------------------------------------------------

  /**
   * GET /portal/profile
   * Read-only profile fields. Sensitive identifiers like passportNumber and
   * cnic are returned masked so they don't leak into screenshots/dev tools
   * if the client is on a shared device.
   */
  async getProfile(user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        alternatePhone: true,
        nationality: true,
        dateOfBirth: true,
        passportNumber: true,
        cnic: true,
        address: true,
        status: true,
        serviceType: true,
        targetCountry: true,
        assignedEmployee: {
          select: { firstName: true, lastName: true },
        },
      },
    });
    if (!client) throw new NotFoundException('Profile not found');

    const mask = (v: string | null) =>
      v && v.length > 4 ? `••••${v.slice(-4)}` : v ?? null;

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      alternatePhone: client.alternatePhone,
      nationality: client.nationality,
      dateOfBirth: client.dateOfBirth,
      passportNumberMasked: mask(client.passportNumber),
      cnicMasked: mask(client.cnic),
      address: client.address,
      status: client.status,
      serviceType: client.serviceType,
      targetCountry: client.targetCountry,
      assignedSalesPersonName: client.assignedEmployee
        ? `${client.assignedEmployee.firstName} ${client.assignedEmployee.lastName}`.trim()
        : null,
    };
  }

  /**
   * POST /portal/profile/update-request
   * Phase 1 implementation: sends a CLIENT_TO_OFFICER message describing
   * the requested change. Phase 2 will introduce a structured
   * ClientProfileUpdateRequest table with explicit approve/reject states.
   */
  async requestProfileUpdate(dto: PortalSendMessageDto, user: RequestUser) {
    const clientId = await this.resolveClientId(user);
    // Pick the most recent active case to attach the message to.
    const activeCase = await this.prisma.processingCase.findFirst({
      where: { clientId, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!activeCase) {
      throw new BadRequestException(
        'No active case found. Profile change requests can only be raised against an active case.',
      );
    }
    return this.sendMessage(
      activeCase.id,
      {
        subject: dto.subject ?? 'Profile update request',
        content: dto.content,
      },
      user,
    );
  }
}
