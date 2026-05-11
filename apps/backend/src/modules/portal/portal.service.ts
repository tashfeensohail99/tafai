import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommunicationDirection,
  CommunicationMessageType,
  DocumentItemStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RequestUser } from '../../common/types/auth.types';
import { PortalSendMessageDto } from './portal.dto';

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

    return items.map((item) => ({
      ...item,
      canUpload: item.status === 'NOT_SUBMITTED' || item.status === 'REJECTED',
      latestRejectionReasonCodes: item.reviewDecisions[0]?.rejectionReasonCodes ?? [],
      reviewDecisions: undefined, // strip the raw relation, expose only the mapped field above
    }));
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

    return this.prisma.$transaction(async (tx) => {
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
}
