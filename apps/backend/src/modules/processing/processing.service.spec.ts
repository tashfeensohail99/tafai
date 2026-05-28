/**
 * Unit tests for ProcessingService — covering the two critical gate checks:
 *   1. Finance gate (Rule 1): createFromHandover / acknowledgeIntake
 *   2. READY_FOR_SUBMISSION gate (Rule 2): changeCaseStage
 *
 * Uses jest.fn() mocks for PrismaService, StorageService, AuditLogService,
 * and ActivityTimelineService — no real database connection required.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentCriticality,
  DocumentItemStatus,
  DocumentValidityRule,
  FinanceHandoverStatus,
  ProcessingCasePriority,
  ProcessingCaseStage,
  VirusScanStatus,
} from '@prisma/client';
import { ProcessingService } from './processing.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<{ id: string; permissions: string[] }> = {}) {
  return {
    id: overrides.id ?? 'user-officer-1',
    email: 'officer@test.com',
    roles: ['processing_officer'],
    permissions: overrides.permissions ?? ['processing.case.view_assigned'],
  };
}

function makeHandover(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'handover-1',
    status: FinanceHandoverStatus.PAYMENT_VERIFIED,
    leadId: 'lead-1',
    financeNotes: null,
    lead: {
      id: 'lead-1',
      serviceInterest: 'Work Permit',
      targetCountry: 'Canada',
      convertedClientId: null,
      branchId: null,
    },
    ...overrides,
  };
}

function makeProcessingCase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'case-1',
    stage: ProcessingCaseStage.INTAKE_PENDING,
    assignedOfficerId: null,
    leadId: 'lead-1',
    clientId: null,
    service: 'Work Permit',
    targetCountry: 'Canada',
    priority: ProcessingCasePriority.NORMAL,
    ...overrides,
  };
}

function makeDocumentItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `doc-${Math.random()}`,
    documentName: 'Passport',
    criticality: DocumentCriticality.CRITICAL,
    status: DocumentItemStatus.ACCEPTED,
    validityExpiryDate: null,
    latestVersionId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory — builds a fully-mocked service
// ---------------------------------------------------------------------------

function buildService() {
  const prismaMock = {
    $transaction: jest.fn(),
    processingCase: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    caseDocumentItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
    processingAuditLog: { create: jest.fn() },
    processingCaseStageHistory: { create: jest.fn() },
    clientDocumentVersion: { findMany: jest.fn() },
    documentReviewDecision: { create: jest.fn() },
    documentAccessLog: { create: jest.fn() },
    caseCommunication: { create: jest.fn(), findMany: jest.fn() },
    processingNote: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    processingTask: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    authoritySubmission: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    documentRequirementTemplate: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    caseMilestone: { createMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    financeHandover: { findUnique: jest.fn(), update: jest.fn() },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'officer-1',
        email: 'officer@example.com',
        userRoles: [{ role: { name: 'processing' } }],
      }),
      findMany: jest.fn(),
    },
  };

  const auditMock = { log: jest.fn() };
  const storageMock = { getSignedUrl: jest.fn().mockResolvedValue('https://signed-url') };
  const timelineMock = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new ProcessingService(
    prismaMock as any,
    auditMock as any,
    storageMock as any,
    timelineMock as any,
    {} as any, // leadsService mock
    { add: jest.fn() } as any, // outbound WhatsApp queue mock
    { enqueue: jest.fn() } as any, // DocumentAiService mock (D2)
  );

  return { service, prismaMock, auditMock, storageMock, timelineMock };
}

// ---------------------------------------------------------------------------
// RULE 1 — Finance gate: createFromHandover
// ---------------------------------------------------------------------------

describe('ProcessingService — Rule 1: Finance Gate (createFromHandover)', () => {
  it('throws NotFoundException when handover does not exist', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.financeHandover.findUnique.mockResolvedValue(null);

    await expect(
      service.createFromHandover({ financeHandoverId: 'handover-missing' }, makeUser()),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when handover status is not PAYMENT_VERIFIED', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.financeHandover.findUnique.mockResolvedValue(
      makeHandover({ status: FinanceHandoverStatus.IN_REVIEW }),
    );

    await expect(
      service.createFromHandover({ financeHandoverId: 'handover-1' }, makeUser()),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when handover status is SENT_TO_PROCESSING (already sent)', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.financeHandover.findUnique.mockResolvedValue(
      makeHandover({ status: FinanceHandoverStatus.SENT_TO_PROCESSING }),
    );

    await expect(
      service.createFromHandover({ financeHandoverId: 'handover-1' }, makeUser()),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ConflictException when a processing case already exists for this handover', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.financeHandover.findUnique.mockResolvedValue(makeHandover());
    prismaMock.processingCase.findUnique.mockResolvedValue(makeProcessingCase());

    await expect(
      service.createFromHandover({ financeHandoverId: 'handover-1' }, makeUser()),
    ).rejects.toThrow(ConflictException);
  });

  it('creates a case and updates handover to SENT_TO_PROCESSING inside a transaction', async () => {
    const { service, prismaMock } = buildService();
    const expectedCase = makeProcessingCase({ id: 'new-case-1' });

    prismaMock.financeHandover.findUnique.mockResolvedValue(makeHandover());
    prismaMock.processingCase.findUnique.mockResolvedValue(null); // no existing case

    // Simulate the $transaction callback executing synchronously
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        processingCase: { create: jest.fn().mockResolvedValue(expectedCase) },
        financeHandover: { update: jest.fn().mockResolvedValue({}) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    const result = await service.createFromHandover(
      { financeHandoverId: 'handover-1', priority: ProcessingCasePriority.URGENT },
      makeUser(),
    );

    expect(result.id).toBe('new-case-1');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// RULE 1 — Finance gate: acknowledgeIntake
// ---------------------------------------------------------------------------

describe('ProcessingService — Rule 1: acknowledgeIntake gate checks', () => {
  it('throws NotFoundException if case does not exist', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(null);

    await expect(
      service.acknowledgeIntake('case-missing', { assignOfficerId: 'officer-1' }, makeUser()),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException if case is not INTAKE_PENDING', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ stage: ProcessingCaseStage.DOCUMENTS_COLLECTION }),
    );

    await expect(
      service.acknowledgeIntake('case-1', { assignOfficerId: 'officer-1' }, makeUser()),
    ).rejects.toThrow(BadRequestException);
  });

  it('acknowledges and builds checklist in a transaction', async () => {
    const { service, prismaMock } = buildService();
    const processingCase = makeProcessingCase({ stage: ProcessingCaseStage.INTAKE_PENDING });
    prismaMock.processingCase.findUnique.mockResolvedValue(processingCase);

    const updatedCase = makeProcessingCase({ stage: ProcessingCaseStage.DOCUMENTS_COLLECTION });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        processingCase: { update: jest.fn().mockResolvedValue(updatedCase) },
        processingCaseStageHistory: { create: jest.fn().mockResolvedValue({}) },
        documentRequirementTemplate: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'tmpl-1',
              documentName: 'Passport',
              description: null,
              criticality: DocumentCriticality.CRITICAL,
              expectedFormats: ['PDF'],
              maxFileSizeMb: 10,
              validityRule: DocumentValidityRule.MUST_NOT_EXPIRE,
              validityMonths: null,
              validityBufferDays: 30,
              sortOrder: 1,
            },
          ]),
        },
        caseDocumentItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        caseMilestone: { createMany: jest.fn().mockResolvedValue({ count: 5 }) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    const result = await service.acknowledgeIntake('case-1', { assignOfficerId: 'officer-1' }, makeUser());

    expect(result.stage).toBe(ProcessingCaseStage.DOCUMENTS_COLLECTION);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  // Soft-fallback path: when no DocumentRequirementTemplate exists for the
  // case's (service, country) pair, the acknowledge no longer throws — it
  // logs a warning and creates the case with an empty checklist. (Was a
  // hard 400 in earlier waves; changed in P2 to keep intake unblocked when
  // admin hasn't curated templates yet.)
  it('acknowledges with empty checklist when no template exists', async () => {
    const { service, prismaMock } = buildService();
    const processingCase = makeProcessingCase({ stage: ProcessingCaseStage.INTAKE_PENDING });
    prismaMock.processingCase.findUnique.mockResolvedValue(processingCase);

    const updatedCase = makeProcessingCase({ stage: ProcessingCaseStage.DOCUMENTS_COLLECTION });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const createMany = jest.fn();
      const txMock = {
        processingCase: { update: jest.fn().mockResolvedValue(updatedCase) },
        processingCaseStageHistory: { create: jest.fn() },
        documentRequirementTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        caseDocumentItem: { createMany },
        caseMilestone: { createMany: jest.fn() },
        processingAuditLog: { create: jest.fn() },
      };
      const result = await cb(txMock);
      // createMany must NOT be called when there are no templates.
      expect(createMany).not.toHaveBeenCalled();
      return result;
    });

    const result = await service.acknowledgeIntake('case-1', { assignOfficerId: 'officer-1' }, makeUser());
    expect(result.stage).toBe(ProcessingCaseStage.DOCUMENTS_COLLECTION);
  });

  it('throws BadRequestException when the assignee is not a processing-side user', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ stage: ProcessingCaseStage.INTAKE_PENDING }),
    );
    // Sales user — not allowed as case assignee.
    prismaMock.userAccount.findUnique.mockResolvedValueOnce({
      id: 'sales-1',
      email: 'sales@example.com',
      userRoles: [{ role: { name: 'sales' } }],
    });

    await expect(
      service.acknowledgeIntake('case-1', { assignOfficerId: 'sales-1' }, makeUser()),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// RULE 2 — READY_FOR_SUBMISSION gate: changeCaseStage
// ---------------------------------------------------------------------------

describe('ProcessingService — Rule 2: Stage transition gate checks', () => {
  it('rejects an invalid stage transition', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.INTAKE_PENDING,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.SUBMITTED }, // cannot jump from INTAKE_PENDING to SUBMITTED
        makeUser({ permissions: ['processing.case.view_assigned', 'processing.case.update_stage'] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires manager permission to cancel a case', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COLLECTION,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.CANCELLED, cancellationReason: 'Client withdrew' },
        makeUser({ permissions: ['processing.case.view_assigned'] }), // no view_all = not manager
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires cancellationReason when cancelling', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COLLECTION,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.CANCELLED }, // no cancellationReason
        makeUser({ permissions: ['processing.case.view_all', 'processing.case.update_stage'] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires submissionReference when moving to SUBMITTED', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.READY_FOR_SUBMISSION,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    // No blocking docs — gate passes
    prismaMock.caseDocumentItem.findMany.mockResolvedValue([]);

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.SUBMITTED }, // missing submissionReference
        makeUser({
          permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires completionNotes when moving to COMPLETED', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.APPROVED,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.COMPLETED }, // missing completionNotes
        makeUser({
          permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// RULE 2 — assertDocumentsReadyForSubmission (private, tested via changeCaseStage)
// ---------------------------------------------------------------------------

describe('ProcessingService — Rule 2: READY_FOR_SUBMISSION hard gate', () => {
  it('blocks transition when a CRITICAL document is not accepted', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COMPLETE,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    // One CRITICAL doc is still NOT_SUBMITTED
    prismaMock.caseDocumentItem.findMany.mockResolvedValue([
      makeDocumentItem({
        documentName: 'Passport',
        criticality: DocumentCriticality.CRITICAL,
        status: DocumentItemStatus.NOT_SUBMITTED,
      }),
    ]);

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.READY_FOR_SUBMISSION },
        makeUser({
          permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks transition when a REQUIRED document is rejected', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COMPLETE,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    prismaMock.caseDocumentItem.findMany.mockResolvedValue([
      makeDocumentItem({
        documentName: 'Employment Contract',
        criticality: DocumentCriticality.REQUIRED,
        status: DocumentItemStatus.REJECTED,
      }),
    ]);

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.READY_FOR_SUBMISSION },
        makeUser({
          permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks transition when a CRITICAL document is expired', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COMPLETE,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    prismaMock.caseDocumentItem.findMany.mockResolvedValue([
      makeDocumentItem({
        documentName: 'Passport',
        criticality: DocumentCriticality.CRITICAL,
        status: DocumentItemStatus.ACCEPTED,
        validityExpiryDate: yesterday, // already past
      }),
    ]);

    await expect(
      service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.READY_FOR_SUBMISSION },
        makeUser({
          permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes the gate when all CRITICAL+REQUIRED docs are ACCEPTED and not expired', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COMPLETE,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    prismaMock.caseDocumentItem.findMany.mockResolvedValue([
      makeDocumentItem({
        documentName: 'Passport',
        criticality: DocumentCriticality.CRITICAL,
        status: DocumentItemStatus.ACCEPTED,
        validityExpiryDate: nextYear,
      }),
      makeDocumentItem({
        documentName: 'Employment Contract',
        criticality: DocumentCriticality.REQUIRED,
        status: DocumentItemStatus.ACCEPTED,
        validityExpiryDate: null,
      }),
    ]);

    const updatedCase = makeProcessingCase({ stage: ProcessingCaseStage.READY_FOR_SUBMISSION });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        processingCase: { update: jest.fn().mockResolvedValue(updatedCase) },
        processingCaseStageHistory: { create: jest.fn().mockResolvedValue({}) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    const result = await service.changeCaseStage(
      'case-1',
      { toStage: ProcessingCaseStage.READY_FOR_SUBMISSION },
      makeUser({
        permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
      }),
    );

    expect(result.stage).toBe(ProcessingCaseStage.READY_FOR_SUBMISSION);
  });

  it('passes when CRITICAL doc is WAIVED (waiver counts as resolved)', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COMPLETE,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    prismaMock.caseDocumentItem.findMany.mockResolvedValue([
      makeDocumentItem({
        documentName: 'Police Clearance',
        criticality: DocumentCriticality.CRITICAL,
        status: DocumentItemStatus.WAIVED, // waived — should pass
        validityExpiryDate: null,
      }),
    ]);

    const updatedCase = makeProcessingCase({ stage: ProcessingCaseStage.READY_FOR_SUBMISSION });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        processingCase: { update: jest.fn().mockResolvedValue(updatedCase) },
        processingCaseStageHistory: { create: jest.fn().mockResolvedValue({}) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    const result = await service.changeCaseStage(
      'case-1',
      { toStage: ProcessingCaseStage.READY_FOR_SUBMISSION },
      makeUser({
        permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
      }),
    );

    expect(result.stage).toBe(ProcessingCaseStage.READY_FOR_SUBMISSION);
  });

  it('error payload includes the blocking document names', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.DOCUMENTS_COMPLETE,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    prismaMock.caseDocumentItem.findMany.mockResolvedValue([
      makeDocumentItem({
        documentName: 'Passport',
        criticality: DocumentCriticality.CRITICAL,
        status: DocumentItemStatus.NOT_SUBMITTED,
      }),
      makeDocumentItem({
        documentName: 'Birth Certificate',
        criticality: DocumentCriticality.REQUIRED,
        status: DocumentItemStatus.UNDER_REVIEW,
      }),
    ]);

    let caught: BadRequestException | null = null;
    try {
      await service.changeCaseStage(
        'case-1',
        { toStage: ProcessingCaseStage.READY_FOR_SUBMISSION },
        makeUser({
          permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
        }),
      );
    } catch (e) {
      caught = e as BadRequestException;
    }

    expect(caught).not.toBeNull();
    const response = caught!.getResponse() as { blockers: string[] };
    expect(response.blockers).toBeDefined();
    expect(response.blockers[0]).toContain('Passport');
    expect(response.blockers[0]).toContain('Birth Certificate');
  });
});

// ---------------------------------------------------------------------------
// RULE 3 — Signed URL: virus scan gate
// ---------------------------------------------------------------------------

describe('ProcessingService — Rule 3: Signed URL virus scan gate', () => {
  it('blocks access when virus scan is PENDING', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue({
      ...makeDocumentItem({ latestVersionId: 'ver-1' }),
      latestVersion: {
        id: 'ver-1',
        storageKey: 'bucket/secret-key',
        fileName: 'passport.pdf',
        virusScanStatus: VirusScanStatus.PENDING,
      },
    });

    await expect(
      service.getSignedDocumentUrl('case-1', 'doc-1', makeUser()),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks access when virus scan is INFECTED', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue({
      ...makeDocumentItem({ latestVersionId: 'ver-1' }),
      latestVersion: {
        id: 'ver-1',
        storageKey: 'bucket/secret-key',
        fileName: 'passport.pdf',
        virusScanStatus: VirusScanStatus.INFECTED,
      },
    });

    await expect(
      service.getSignedDocumentUrl('case-1', 'doc-1', makeUser()),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns signed URL (not raw storageKey) when scan is CLEAN', async () => {
    const { service, prismaMock, storageMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue({
      ...makeDocumentItem({ latestVersionId: 'ver-1' }),
      latestVersion: {
        id: 'ver-1',
        storageKey: 'bucket/secret-key',
        fileName: 'passport.pdf',
        virusScanStatus: VirusScanStatus.CLEAN,
      },
    });
    prismaMock.documentAccessLog = { create: jest.fn().mockResolvedValue({}) };
    storageMock.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-token?...');

    const result = await service.getSignedDocumentUrl('case-1', 'doc-1', makeUser());

    expect(result.url).toBe('https://s3.example.com/signed-token?...');
    expect(result.url).not.toContain('secret-key'); // raw key never leaked
    expect(storageMock.getSignedUrl).toHaveBeenCalledWith('bucket/secret-key');
  });
});

// ---------------------------------------------------------------------------
// RULE 4 — Document review is append-only
// ---------------------------------------------------------------------------

describe('ProcessingService — Rule 4: Document review append-only', () => {
  it('throws when reviewing a document that has not passed virus scan', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue({
      ...makeDocumentItem({ latestVersionId: 'ver-1' }),
      latestVersion: {
        id: 'ver-1',
        virusScanStatus: VirusScanStatus.PENDING,
      },
    });

    await expect(
      service.reviewDocument('case-1', 'doc-1', { decision: 'ACCEPTED' } as any, makeUser()),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when rejecting without rejection reason codes', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue({
      ...makeDocumentItem({ latestVersionId: 'ver-1' }),
      latestVersion: {
        id: 'ver-1',
        virusScanStatus: VirusScanStatus.CLEAN,
      },
    });

    await expect(
      service.reviewDocument(
        'case-1',
        'doc-1',
        { decision: 'REJECTED', rejectionReasonCodes: [] } as any, // empty codes
        makeUser(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a new review decision row (append) on accept — does not update old decision', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue({
      ...makeDocumentItem({ latestVersionId: 'ver-1', status: DocumentItemStatus.REJECTED }),
      latestVersion: {
        id: 'ver-1',
        virusScanStatus: VirusScanStatus.CLEAN,
      },
    });

    const decisionCreate = jest.fn().mockResolvedValue({});
    const itemUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        documentReviewDecision: { create: decisionCreate },
        caseDocumentItem: { update: itemUpdate },
        processingAuditLog: { create: auditCreate },
      };
      return cb(txMock);
    });

    const result = await service.reviewDocument(
      'case-1',
      'doc-1',
      { decision: 'ACCEPTED' } as any,
      makeUser(),
    );

    // A new row was CREATED (not updated)
    expect(decisionCreate).toHaveBeenCalledTimes(1);
    expect(decisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ decision: 'ACCEPTED' }) }),
    );
    expect(result.newStatus).toBe(DocumentItemStatus.ACCEPTED);
  });
});

// ---------------------------------------------------------------------------
// AUDIT POINT 11 — CRITICAL document waiver requires manager permission
// ---------------------------------------------------------------------------

describe('ProcessingService — Waiver permission gate', () => {
  it('allows a normal officer to waive a REQUIRED document', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    const requiredItem = makeDocumentItem({ criticality: DocumentCriticality.REQUIRED });
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue(requiredItem);

    const updatedItem = { ...requiredItem, status: DocumentItemStatus.WAIVED };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        caseDocumentItem: { update: jest.fn().mockResolvedValue(updatedItem) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    const result = await service.waiveDocumentItem(
      'case-1',
      requiredItem.id,
      { waiveReason: 'Not applicable for this nationality' },
      makeUser({ permissions: ['processing.case.view_assigned', 'processing.document.waive'] }),
    );

    expect(result.status).toBe(DocumentItemStatus.WAIVED);
  });

  it('blocks a normal officer from waiving a CRITICAL document', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    const criticalItem = makeDocumentItem({ criticality: DocumentCriticality.CRITICAL });
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue(criticalItem);

    await expect(
      service.waiveDocumentItem(
        'case-1',
        criticalItem.id,
        { waiveReason: 'Not needed' },
        makeUser({ permissions: ['processing.case.view_assigned', 'processing.document.waive'] }),
        // no processing.case.view_all = not a manager
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a manager to waive a CRITICAL document', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'user-officer-1' }),
    );
    const criticalItem = makeDocumentItem({ criticality: DocumentCriticality.CRITICAL });
    prismaMock.caseDocumentItem.findFirst.mockResolvedValue(criticalItem);

    const updatedItem = { ...criticalItem, status: DocumentItemStatus.WAIVED };
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        caseDocumentItem: { update: jest.fn().mockResolvedValue(updatedItem) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    const result = await service.waiveDocumentItem(
      'case-1',
      criticalItem.id,
      { waiveReason: 'Approved exception — manager override' },
      makeUser({
        permissions: ['processing.case.view_all', 'processing.document.waive'],
      }),
    );

    expect(result.status).toBe(DocumentItemStatus.WAIVED);
  });
});

// ---------------------------------------------------------------------------
// AUDIT POINTS 14 & 15 — Case access control (officer isolation)
// ---------------------------------------------------------------------------

describe('ProcessingService — Case access control', () => {
  it('blocks a non-assigned officer from viewing a case', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'some-other-officer' }),
    );

    await expect(
      service.getCaseById(
        'case-1',
        makeUser({ id: 'user-officer-1', permissions: ['processing.case.view_assigned'] }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a manager to access any case regardless of assignment', async () => {
    const { service, prismaMock } = buildService();
    const unrelatedCase = {
      ...makeProcessingCase({ assignedOfficerId: 'someone-else' }),
      lead: null,
      client: null,
      assignedOfficer: null,
      financeHandover: null,
      stageHistory: [],
      _count: { documentItems: 0, tasks: 0, notes: 0 },
    };
    prismaMock.processingCase.findUnique.mockResolvedValue(unrelatedCase);

    const result = await service.getCaseById(
      'case-1',
      makeUser({ id: 'manager-1', permissions: ['processing.case.view_all'] }),
    );

    expect(result.id).toBe('case-1');
  });

  it('blocks a non-assigned officer from getting a signed URL for a document', async () => {
    const { service, prismaMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({ assignedOfficerId: 'some-other-officer' }),
    );

    await expect(
      service.getSignedDocumentUrl(
        'case-1',
        'doc-1',
        makeUser({ id: 'user-officer-1', permissions: ['processing.case.view_assigned'] }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// AUDIT POINT 20 — Timeline failure does not break the request
// ---------------------------------------------------------------------------

describe('ProcessingService — Timeline resilience', () => {
  it('completes stage change successfully even if timeline.record rejects', async () => {
    const { service, prismaMock, timelineMock } = buildService();
    prismaMock.processingCase.findUnique.mockResolvedValue(
      makeProcessingCase({
        stage: ProcessingCaseStage.APPROVED,
        assignedOfficerId: 'user-officer-1',
      }),
    );

    const updatedCase = makeProcessingCase({ stage: ProcessingCaseStage.COMPLETED });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const txMock = {
        processingCase: { update: jest.fn().mockResolvedValue(updatedCase) },
        processingCaseStageHistory: { create: jest.fn().mockResolvedValue({}) },
        processingAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return cb(txMock);
    });

    // Simulate timeline service being unreachable
    timelineMock.record.mockRejectedValue(new Error('Timeline service unavailable'));

    // Stage change must still succeed — timeline is fire-and-forget (void)
    const result = await service.changeCaseStage(
      'case-1',
      { toStage: ProcessingCaseStage.COMPLETED, completionNotes: 'Visa approved and issued.' },
      makeUser({
        permissions: ['processing.case.view_assigned', 'processing.case.update_stage'],
      }),
    );

    expect(result.stage).toBe(ProcessingCaseStage.COMPLETED);
    // Audit log inside transaction must still have been written
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
