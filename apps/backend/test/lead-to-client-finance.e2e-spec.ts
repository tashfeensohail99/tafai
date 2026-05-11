import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceStatus,
  LeadStatus,
  PaymentStatus,
  TimelineEventType,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/common/prisma/prisma.service';

const TEST_PASSWORD = 'E2eFinance!123';
const PERMISSION_KEYS = [
  'leads.create',
  'finance.create_invoice',
  'finance.record_payment',
  'finance.verify_payment',
  'finance.view_all',
];

interface ScenarioState {
  leadIds: string[];
  clientIds: string[];
  caseIds: string[];
  invoiceIds: string[];
  paymentIds: string[];
}

describe('Lead To Client Finance Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let testUserId: string;
  let testRoleId: string;
  let testUserEmail: string;
  let scenario: ScenarioState;

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

    const suffix = randomUUID().slice(0, 8);
    testUserEmail = `e2e.finance.${suffix}@tashfeen.test`;

    const permissions = await Promise.all(
      PERMISSION_KEYS.map((key) =>
        prisma.permission.upsert({
          where: { key },
          update: {},
          create: {
            key,
            module: key.split('.')[0],
            description: `E2E permission for ${key}`,
          },
        }),
      ),
    );

    const role = await prisma.role.create({
      data: {
        name: `E2E_FINANCE_${suffix}`,
        displayName: 'E2E Finance Test Role',
        description: 'Temporary role for backend finance e2e coverage',
      },
    });
    testRoleId = role.id;

    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
    });

    const user = await prisma.userAccount.create({
      data: {
        email: testUserEmail,
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    testUserId = user.id;

    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });
  });

  beforeEach(() => {
    scenario = {
      leadIds: [],
      clientIds: [],
      caseIds: [],
      invoiceIds: [],
      paymentIds: [],
    };
  });

  afterEach(async () => {
    await cleanupScenario();
  });

  afterAll(async () => {
    await prisma.loginSession.deleteMany({ where: { userId: testUserId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: testUserId } });
    await prisma.userRole.deleteMany({ where: { userId: testUserId } });
    await prisma.userAccount.delete({ where: { id: testUserId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: testRoleId } });
    await prisma.role.delete({ where: { id: testRoleId } });
    await app.close();
  });

  it('converts a lead after finance verification and serializes Decimal fields as strings', async () => {
    const authToken = await login();
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
    const phone = `9${suffix.slice(-9)}`;
    const email = `lead.finance.${suffix}@tashfeen.test`;

    const createLeadResponse = await request(server)
      .post('/leads')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Finance',
        lastName: 'Regression',
        email,
        phone,
        serviceInterest: 'Work Permit',
        targetCountry: 'Canada',
        sourceChannel: 'Walk In',
        notes: 'Created by automated e2e coverage',
      })
      .expect(201);

    const leadId = createLeadResponse.body.id as string;
    scenario.leadIds.push(leadId);

    const createInvoiceResponse = await request(server)
      .post('/finance/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        leadId,
        subtotal: '100',
        taxAmount: '0',
        discountAmount: '0',
        notes: 'Finance e2e regression coverage',
      })
      .expect(201);

    const invoiceId = createInvoiceResponse.body.id as string;
    scenario.invoiceIds.push(invoiceId);

    expect(createInvoiceResponse.body.status).toBe(InvoiceStatus.SENT);
    expect(createInvoiceResponse.body.totalAmount).toBe('100');
    expect(typeof createInvoiceResponse.body.totalAmount).toBe('string');
    expect(createInvoiceResponse.body.paidAmount).toBe('0');
    expect(typeof createInvoiceResponse.body.paidAmount).toBe('string');

    const recordPaymentResponse = await request(server)
      .post('/finance/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        invoiceId,
        amount: '100',
        paymentMethod: 'Cash',
        transactionRef: `E2E-${suffix}`,
      })
      .expect(201);

    const paymentId = recordPaymentResponse.body.id as string;
    scenario.paymentIds.push(paymentId);

    expect(recordPaymentResponse.body.status).toBe(PaymentStatus.PENDING);
    expect(recordPaymentResponse.body.amount).toBe('100');
    expect(typeof recordPaymentResponse.body.amount).toBe('string');

    const verifyPaymentResponse = await request(server)
      .post(`/finance/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ notes: 'Verified by e2e regression coverage' })
      .expect(201);

    const clientId = verifyPaymentResponse.body.clientId as string;
    const caseId = verifyPaymentResponse.body.caseId as string;
    scenario.clientIds.push(clientId);
    scenario.caseIds.push(caseId);

    expect(verifyPaymentResponse.body.payment.status).toBe(PaymentStatus.PAID);
    expect(verifyPaymentResponse.body.payment.amount).toBe('100');
    expect(typeof verifyPaymentResponse.body.payment.amount).toBe('string');
    expect(verifyPaymentResponse.body.invoice.status).toBe(InvoiceStatus.PAID);
    expect(verifyPaymentResponse.body.invoice.totalAmount).toBe('100');
    expect(typeof verifyPaymentResponse.body.invoice.totalAmount).toBe('string');
    expect(verifyPaymentResponse.body.invoice.paidAmount).toBe('100');
    expect(typeof verifyPaymentResponse.body.invoice.paidAmount).toBe('string');
    expect(verifyPaymentResponse.body.invoice.clientId).toBe(clientId);
    expect(verifyPaymentResponse.body.invoice.caseId).toBe(caseId);

    const listInvoicesResponse = await request(server)
      .get('/finance/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const listedInvoice = (listInvoicesResponse.body as Array<Record<string, unknown>>).find(
      (invoice) => invoice.id === invoiceId,
    ) as Record<string, unknown> | undefined;

    expect(listedInvoice).toBeDefined();
    expect(listedInvoice?.totalAmount).toBe('100');
    expect(typeof listedInvoice?.totalAmount).toBe('string');
    expect(listedInvoice?.paidAmount).toBe('100');
    expect(typeof listedInvoice?.paidAmount).toBe('string');
    expect(Array.isArray(listedInvoice?.payments)).toBe(true);
    expect((listedInvoice?.payments as Array<Record<string, unknown>>)[0]?.amount).toBe('100');
    expect(typeof (listedInvoice?.payments as Array<Record<string, unknown>>)[0]?.amount).toBe('string');

    const persistedLead = await prisma.lead.findUnique({ where: { id: leadId } });
    const persistedClient = await prisma.client.findUnique({ where: { id: clientId } });
    const persistedCase = await prisma.case.findUnique({ where: { id: caseId } });
    const persistedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    const leadPaymentTimeline = await prisma.activityTimeline.findFirst({
      where: {
        leadId,
        eventType: TimelineEventType.PAYMENT_RECEIVED,
      },
      orderBy: { createdAt: 'desc' },
    });
    const casePaymentTimeline = await prisma.activityTimeline.findFirst({
      where: {
        clientId,
        caseId,
        eventType: TimelineEventType.PAYMENT_RECEIVED,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(persistedLead?.status).toBe(LeadStatus.CONVERTED);
    expect(persistedLead?.convertedClientId).toBe(clientId);
    expect(persistedClient?.email).toBe(email);
    expect(persistedClient?.phone).toBe(phone);
    expect(persistedCase?.clientId).toBe(clientId);
    expect(persistedCase?.serviceType).toBe('Work Permit');
    expect(persistedCase?.targetCountry).toBe('Canada');
    expect(persistedInvoice?.clientId).toBe(clientId);
    expect(persistedInvoice?.caseId).toBe(caseId);
    expect(persistedInvoice?.status).toBe(InvoiceStatus.PAID);
    expect(leadPaymentTimeline).not.toBeNull();
    expect(casePaymentTimeline).not.toBeNull();
  });

  async function login(): Promise<string> {
    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ email: testUserEmail, password: TEST_PASSWORD })
      .expect(200);

    return loginResponse.body.accessToken as string;
  }

  async function cleanupScenario(): Promise<void> {
    const entityIds = [
      ...scenario.leadIds,
      ...scenario.clientIds,
      ...scenario.caseIds,
      ...scenario.invoiceIds,
      ...scenario.paymentIds,
    ];

    const timelineConditions: Array<Record<string, unknown>> = [];
    if (scenario.leadIds.length > 0) {
      timelineConditions.push({ leadId: { in: scenario.leadIds } });
    }
    if (scenario.clientIds.length > 0) {
      timelineConditions.push({ clientId: { in: scenario.clientIds } });
    }
    if (scenario.caseIds.length > 0) {
      timelineConditions.push({ caseId: { in: scenario.caseIds } });
    }
    if (entityIds.length > 0) {
      timelineConditions.push({ entityId: { in: entityIds } });
    }
    if (timelineConditions.length > 0) {
      await prisma.activityTimeline.deleteMany({ where: { OR: timelineConditions } });
    }

    const auditConditions: Array<Record<string, unknown>> = [{ actorUserId: testUserId }];
    if (entityIds.length > 0) {
      auditConditions.push({ entityId: { in: entityIds } });
    }
    await prisma.auditLog.deleteMany({ where: { OR: auditConditions } });

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

    await prisma.loginSession.deleteMany({ where: { userId: testUserId } });
  }
});