import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DocReviewDecisionType,
  DocumentCriticality,
  DocumentItemStatus,
  DocumentValidityRule,
  FinanceHandoverStatus,
  LeadStatus,
  PaymentStatus,
  ProcessingCaseStage,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/common/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PASSWORD = 'E2eProcessing!123';

const OFFICER_PERMISSIONS = [
  'processing.intake.view',
  'processing.intake.acknowledge',
  'processing.case.view_assigned',
  'processing.case.view_all',
  'processing.case.update_stage',
  'processing.case.assign',
  'processing.document.review',
  'processing.document.upload',
  'processing.document.waive',
  'processing.document.request',
  'processing.note.create',
  'processing.note.view_all',
  'processing.task.create',
  'processing.task.update',
  'processing.report.export',
  // Finance permission needed to POST /processing/intake
  'finance.view_all',
  // Lead creation for scenario bootstrap
  'leads.create',
  'finance.create_invoice',
  'finance.record_payment',
  'finance.verify_payment',
];

// Second user — client-portal-level, used for isolation tests
const CLIENT_PERMISSIONS: string[] = [];

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

interface ScenarioState {
  leadIds: string[];
  clientIds: string[];
  caseIds: string[];
  processingCaseIds: string[];
  handoverIds: string[];
  invoiceIds: string[];
  paymentIds: string[];
  documentItemIds: string[];
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Processing Module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  // Primary officer user
  let officerUserId: string;
  let officerRoleId: string;
  let officerEmail: string;

  // Second user — isolation checks
  let otherUserId: string;
  let otherRoleId: string;
  let otherEmail: string;

  let scenario: ScenarioState;
  let suffix: string;

  // ---------------------------------------------------------------------------
  // beforeAll — bootstrap app, create test users and roles
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    server = app.getHttpServer();

    const uniq = randomUUID().slice(0, 8);

    // ---- Officer user ----
    officerEmail = `e2e.processing.officer.${uniq}@tashfeen.test`;

    const officerPermissions = await Promise.all(
      OFFICER_PERMISSIONS.map((key) =>
        prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, module: key.split('.')[0], description: `E2E perm ${key}` },
        }),
      ),
    );

    const officerRole = await prisma.role.create({
      data: {
        name: `E2E_PROC_OFFICER_${uniq}`,
        displayName: 'E2E Processing Officer',
        description: 'Temp role for processing e2e',
      },
    });
    officerRoleId = officerRole.id;

    await prisma.rolePermission.createMany({
      data: officerPermissions.map((p) => ({ roleId: officerRole.id, permissionId: p.id })),
    });

    const officerUser = await prisma.userAccount.create({
      data: {
        email: officerEmail,
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    officerUserId = officerUser.id;

    await prisma.userRole.create({ data: { userId: officerUser.id, roleId: officerRole.id } });

    // ---- Other (isolated) user ----
    otherEmail = `e2e.processing.other.${uniq}@tashfeen.test`;
    const otherRole = await prisma.role.create({
      data: {
        name: `E2E_PROC_OTHER_${uniq}`,
        displayName: 'E2E Other',
        description: 'Temp isolated user for processing e2e',
      },
    });
    otherRoleId = otherRole.id;

    const otherUser = await prisma.userAccount.create({
      data: {
        email: otherEmail,
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    otherUserId = otherUser.id;
    await prisma.userRole.create({ data: { userId: otherUser.id, roleId: otherRole.id } });
  });

  // ---------------------------------------------------------------------------
  // beforeEach — fresh scenario state + unique suffix per test
  // ---------------------------------------------------------------------------

  beforeEach(() => {
    suffix = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    scenario = {
      leadIds: [],
      clientIds: [],
      caseIds: [],
      processingCaseIds: [],
      handoverIds: [],
      invoiceIds: [],
      paymentIds: [],
      documentItemIds: [],
    };
  });

  afterEach(async () => {
    await cleanupScenario();
  });

  afterAll(async () => {
    // Cleanup both users and roles
    for (const userId of [officerUserId, otherUserId]) {
      await prisma.loginSession.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.userAccount.delete({ where: { id: userId } });
    }
    for (const roleId of [officerRoleId, otherRoleId]) {
      await prisma.rolePermission.deleteMany({ where: { roleId } });
      await prisma.role.delete({ where: { id: roleId } });
    }
    await app.close();
  });

  // ===========================================================================
  // Test 1: Finance handover → Processing intake → acknowledge
  // ===========================================================================

  it('creates a processing case from finance handover and acknowledges intake', async () => {
    const token = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(token);

    // Verify case is in DOCUMENTS_COLLECTION after acknowledge
    const caseRes = await request(server)
      .get(`/processing/cases/${processingCaseId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(caseRes.body.stage).toBe(ProcessingCaseStage.DOCUMENTS_COLLECTION);
    expect(caseRes.body.assignedOfficerId).toBe(officerUserId);
  });

  // ===========================================================================
  // Test 2: Document upload → review (accept) → check status
  // ===========================================================================

  it('adds a document item, accepts it, and reflects ACCEPTED status', async () => {
    const token = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(token);

    // Add a CRITICAL document item
    const addDocRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        documentName: 'Police Clearance Certificate',
        description: 'National police clearance',
        criticality: DocumentCriticality.CRITICAL,
        validityRule: DocumentValidityRule.NONE,
        expectedFormats: ['PDF'],
        maxFileSizeMb: 10,
      })
      .expect(201);

    const itemId = addDocRes.body.id as string;
    scenario.documentItemIds.push(itemId);

    expect(addDocRes.body.status).toBe(DocumentItemStatus.NOT_SUBMITTED);
    expect(addDocRes.body.criticality).toBe(DocumentCriticality.CRITICAL);

    // Simulate a submitted version directly in DB (upload requires real file)
    await prisma.caseDocumentItem.update({
      where: { id: itemId },
      data: { status: DocumentItemStatus.SUBMITTED },
    });

    // Review: ACCEPTED
    const reviewRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents/${itemId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: DocReviewDecisionType.ACCEPTED })
      .expect(201);

    expect(reviewRes.body.status).toBe(DocumentItemStatus.ACCEPTED);

    // Audit log must record the review
    const auditEntry = await prisma.processingAuditLog.findFirst({
      where: { caseId: processingCaseId, action: 'document_accepted' },
    });
    expect(auditEntry).not.toBeNull();
  });

  // ===========================================================================
  // Test 3: Document rejection → stage blocked
  // ===========================================================================

  it('rejects a CRITICAL document and blocks READY_FOR_SUBMISSION stage transition', async () => {
    const token = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(token);

    // Add a CRITICAL document, set to SUBMITTED, then reject
    const addDocRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        documentName: 'IELTS Result',
        criticality: DocumentCriticality.CRITICAL,
        validityRule: DocumentValidityRule.NONE,
      })
      .expect(201);

    const itemId = addDocRes.body.id as string;
    scenario.documentItemIds.push(itemId);

    await prisma.caseDocumentItem.update({
      where: { id: itemId },
      data: { status: DocumentItemStatus.SUBMITTED },
    });

    await request(server)
      .post(`/processing/cases/${processingCaseId}/documents/${itemId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: DocReviewDecisionType.REJECTED, rejectionNote: 'Score below minimum' })
      .expect(201);

    // Advance to DOCUMENTS_COMPLETE first (required before READY_FOR_SUBMISSION)
    // This should fail because a CRITICAL doc is REJECTED
    const stageRes = await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStage: ProcessingCaseStage.READY_FOR_SUBMISSION })
      .expect(400); // gate must block

    expect(stageRes.body.message).toMatch(/document|gate|blocked|required/i);
  });

  // ===========================================================================
  // Test 4: READY_FOR_SUBMISSION gate — all CRITICAL+REQUIRED accepted → passes
  // ===========================================================================

  it('allows READY_FOR_SUBMISSION when all CRITICAL and REQUIRED docs are accepted', async () => {
    const token = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(token);

    // Add one CRITICAL item, one REQUIRED item, accept both; add OPTIONAL item not submitted
    const criticalRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentName: 'Passport', criticality: 'CRITICAL', validityRule: 'NONE' })
      .expect(201);
    scenario.documentItemIds.push(criticalRes.body.id);

    const requiredRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentName: 'Bank Statement', criticality: 'REQUIRED', validityRule: 'NONE' })
      .expect(201);
    scenario.documentItemIds.push(requiredRes.body.id);

    const optionalRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentName: 'Cover Letter', criticality: 'OPTIONAL', validityRule: 'NONE' })
      .expect(201);
    scenario.documentItemIds.push(optionalRes.body.id);

    // Set critical + required to SUBMITTED then ACCEPTED
    for (const itemId of [criticalRes.body.id, requiredRes.body.id]) {
      await prisma.caseDocumentItem.update({
        where: { id: itemId },
        data: { status: DocumentItemStatus.SUBMITTED },
      });
      await request(server)
        .post(`/processing/cases/${processingCaseId}/documents/${itemId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: DocReviewDecisionType.ACCEPTED })
        .expect(201);
    }

    // Advance case stage step by step to reach READY_FOR_SUBMISSION
    // DOCUMENTS_COLLECTION → DOCUMENTS_UNDER_REVIEW → DOCUMENTS_COMPLETE → READY_FOR_SUBMISSION
    await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStage: ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW })
      .expect(200);

    await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStage: ProcessingCaseStage.DOCUMENTS_COMPLETE })
      .expect(200);

    const readyRes = await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStage: ProcessingCaseStage.READY_FOR_SUBMISSION })
      .expect(200);

    expect(readyRes.body.stage).toBe(ProcessingCaseStage.READY_FOR_SUBMISSION);
  });

  // ===========================================================================
  // Test 5: Client portal isolation — other user cannot see this case
  // ===========================================================================

  it('prevents a user without processing.case.view_all from accessing another officer\'s case', async () => {
    const officerToken = await login(officerEmail);
    const otherToken = await login(otherEmail);

    const { processingCaseId } = await bootstrapProcessingCase(officerToken);

    // Other user has no processing permissions — must get 403
    await request(server)
      .get(`/processing/cases/${processingCaseId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  // ===========================================================================
  // Test 6: Case cancellation (manager only)
  // ===========================================================================

  it('allows manager to cancel a case with a reason, blocks without view_all', async () => {
    const officerToken = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(officerToken);

    // Officer has processing.case.view_all in this test setup, so use other user (no perms)
    const otherToken = await login(otherEmail);

    // User without permission: 403
    await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ toStage: ProcessingCaseStage.CANCELLED, cancellationReason: 'Client withdrew' })
      .expect(403);

    // Officer (has view_all): 200
    const cancelRes = await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ toStage: ProcessingCaseStage.CANCELLED, cancellationReason: 'Client formally withdrew the application' })
      .expect(200);

    expect(cancelRes.body.stage).toBe(ProcessingCaseStage.CANCELLED);
    expect(cancelRes.body.cancellationReason).toBe('Client formally withdrew the application');

    // Audit log: stage changed to CANCELLED
    const auditEntry = await prisma.processingAuditLog.findFirst({
      where: { caseId: processingCaseId, action: 'case_stage_changed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
    const newValues = auditEntry?.newValues as Record<string, unknown>;
    expect(newValues?.toStage).toBe(ProcessingCaseStage.CANCELLED);
  });

  // ===========================================================================
  // Test 7: Missing cancellation reason → 400
  // ===========================================================================

  it('rejects CANCELLED stage transition when cancellationReason is missing', async () => {
    const token = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(token);

    const res = await request(server)
      .patch(`/processing/cases/${processingCaseId}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStage: ProcessingCaseStage.CANCELLED }) // no cancellationReason
      .expect(400);

    expect(res.body.message).toMatch(/cancellation.*reason|reason.*required/i);
  });

  // ===========================================================================
  // Test 8: Processing audit log written for document review
  // ===========================================================================

  it('writes a processing audit log entry for every document review decision', async () => {
    const token = await login(officerEmail);
    const { processingCaseId } = await bootstrapProcessingCase(token);

    const addRes = await request(server)
      .post(`/processing/cases/${processingCaseId}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ documentName: 'Degree Certificate', criticality: 'REQUIRED', validityRule: 'NONE' })
      .expect(201);

    const itemId = addRes.body.id as string;
    scenario.documentItemIds.push(itemId);

    await prisma.caseDocumentItem.update({
      where: { id: itemId },
      data: { status: DocumentItemStatus.SUBMITTED },
    });

    await request(server)
      .post(`/processing/cases/${processingCaseId}/documents/${itemId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: DocReviewDecisionType.REJECTED, rejectionNote: 'Wrong format' })
      .expect(201);

    const auditEntry = await prisma.processingAuditLog.findFirst({
      where: { caseId: processingCaseId, action: 'document_rejected' },
    });

    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorUserId).toBe(officerUserId);
    const newValues = auditEntry?.newValues as Record<string, unknown>;
    expect(newValues?.status).toBe(DocumentItemStatus.REJECTED);
  });

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Full bootstrap: Lead → Invoice → Payment → Verify → FinanceHandover (direct DB) →
   * POST /processing/intake → acknowledge → returns processingCaseId.
   */
  async function bootstrapProcessingCase(token: string): Promise<{ processingCaseId: string }> {
    const phone = `9${suffix.slice(-9)}`;
    const email = `proc.client.${suffix}@tashfeen.test`;

    // 1. Create lead
    const leadRes = await request(server)
      .post('/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Processing',
        lastName: `Test${suffix}`,
        email,
        phone,
        serviceInterest: 'PR Application',
        targetCountry: 'Canada',
        sourceChannel: 'Walk In',
        notes: 'Created by processing e2e coverage',
      })
      .expect(201);

    const leadId = leadRes.body.id as string;
    scenario.leadIds.push(leadId);

    // 2. Create invoice
    const invoiceRes = await request(server)
      .post('/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ leadId, subtotal: '500', taxAmount: '0', discountAmount: '0' })
      .expect(201);

    const invoiceId = invoiceRes.body.id as string;
    scenario.invoiceIds.push(invoiceId);

    // 3. Record payment
    const paymentRes = await request(server)
      .post('/finance/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId, amount: '500', paymentMethod: 'Bank Transfer', transactionRef: `E2E-PROC-${suffix}` })
      .expect(201);

    const paymentId = paymentRes.body.id as string;
    scenario.paymentIds.push(paymentId);

    // 4. Verify payment → creates client + case
    const verifyRes = await request(server)
      .post(`/finance/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Processing e2e regression' })
      .expect(201);

    const clientId = verifyRes.body.clientId as string;
    const caseId = verifyRes.body.caseId as string;
    scenario.clientIds.push(clientId);
    scenario.caseIds.push(caseId);

    expect(verifyRes.body.payment.status).toBe(PaymentStatus.PAID);

    // 5. Create FinanceHandover directly in DB (mirrors what Finance UI triggers)
    const handover = await prisma.financeHandover.create({
      data: {
        leadId,
        invoiceId,
        paymentId,
        createdByUserId: officerUserId,
        status: FinanceHandoverStatus.PAYMENT_VERIFIED,
        submittedAmount: 500,
        currency: 'PKR',
        paymentMethod: 'Bank Transfer',
        transactionRef: `E2E-PROC-${suffix}`,
        receiptKey: `receipts/e2e-${suffix}.pdf`,
        receiptFileName: `receipt-${suffix}.pdf`,
        submittedAt: new Date(),
      },
    });
    scenario.handoverIds.push(handover.id);

    // 6. Create processing case from handover
    const intakeRes = await request(server)
      .post('/processing/intake')
      .set('Authorization', `Bearer ${token}`)
      .send({ financeHandoverId: handover.id, priority: 'NORMAL' })
      .expect(201);

    // createFromHandover returns a discriminated union — a normal service opens a
    // ProcessingCase under { kind: 'processing', case }. (JR_RESUBMISSION would
    // return { kind: 'jr', matter } instead, but this scenario is a normal service.)
    const processingCaseId = intakeRes.body.case.id as string;
    scenario.processingCaseIds.push(processingCaseId);

    expect(intakeRes.body.case.stage).toBe(ProcessingCaseStage.INTAKE_PENDING);

    // 7. Acknowledge intake → moves to DOCUMENTS_COLLECTION
    await request(server)
      .post(`/processing/intake/${processingCaseId}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .send({}) // assigns to self
      .expect(201);

    return { processingCaseId };
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function cleanupScenario(): Promise<void> {
    // Processing-specific cleanup (must go before leads/clients/cases)
    if (scenario.documentItemIds.length > 0) {
      await prisma.processingAuditLog.deleteMany({
        where: { caseId: { in: scenario.processingCaseIds } },
      });
      await prisma.caseDocumentItem.deleteMany({
        where: { id: { in: scenario.documentItemIds } },
      });
    }
    if (scenario.processingCaseIds.length > 0) {
      await prisma.processingAuditLog.deleteMany({
        where: { caseId: { in: scenario.processingCaseIds } },
      });
      await prisma.processingCaseStageHistory.deleteMany({
        where: { caseId: { in: scenario.processingCaseIds } },
      });
      await prisma.processingCase.deleteMany({
        where: { id: { in: scenario.processingCaseIds } },
      });
    }
    if (scenario.handoverIds.length > 0) {
      await prisma.financeHandover.deleteMany({
        where: { id: { in: scenario.handoverIds } },
      });
    }

    // Activity timeline
    const entityIds = [
      ...scenario.leadIds,
      ...scenario.clientIds,
      ...scenario.caseIds,
      ...scenario.processingCaseIds,
    ];
    const timelineConditions: Array<Record<string, unknown>> = [];
    if (scenario.leadIds.length > 0) timelineConditions.push({ leadId: { in: scenario.leadIds } });
    if (scenario.clientIds.length > 0) timelineConditions.push({ clientId: { in: scenario.clientIds } });
    if (scenario.caseIds.length > 0) timelineConditions.push({ caseId: { in: scenario.caseIds } });
    if (entityIds.length > 0) timelineConditions.push({ entityId: { in: entityIds } });
    if (timelineConditions.length > 0) {
      await prisma.activityTimeline.deleteMany({ where: { OR: timelineConditions } });
    }

    const auditConditions: Array<Record<string, unknown>> = [
      { actorUserId: officerUserId },
      { actorUserId: otherUserId },
    ];
    if (entityIds.length > 0) auditConditions.push({ entityId: { in: entityIds } });
    await prisma.auditLog.deleteMany({ where: { OR: auditConditions } });

    // Finance objects
    if (scenario.paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: scenario.paymentIds } } });
    }
    if (scenario.invoiceIds.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: scenario.invoiceIds } } });
    }
    if (scenario.caseIds.length > 0) {
      await prisma.case.deleteMany({ where: { id: { in: scenario.caseIds } } });
    }
    if (scenario.clientIds.length > 0) {
      await prisma.client.deleteMany({ where: { id: { in: scenario.clientIds } } });
    }
    if (scenario.leadIds.length > 0) {
      await prisma.lead.deleteMany({ where: { id: { in: scenario.leadIds } } });
    }

    await prisma.loginSession.deleteMany({ where: { userId: officerUserId } });
    await prisma.loginSession.deleteMany({ where: { userId: otherUserId } });
  }
});
