/**
 * Seed the demo-only rows into the DEMO database (run AFTER the first sync so
 * the organisation, roles, branches and departments exist):
 *
 *   - demo admin + demo agent logins (fixed ids, protected from pruning)
 *   - the OpenAI key the demo's own AI uses (DEMO_OPENAI_API_KEY)
 *   - the live-lane WhatsApp channel (DEMO_LIVE_* vars)
 *
 *   npm run demo:seed
 *   node dist/modules/demo/cli/seed.js
 *
 * Required env: DATABASE_URL (demo), WHATSAPP_ENCRYPTION_KEY (demo's own key),
 * DEMO_ADMIN_PASSWORD, DEMO_AGENT_PASSWORD. Optional: DEMO_OPENAI_API_KEY,
 * DEMO_LIVE_WABA_ID, DEMO_LIVE_PHONE_NUMBER_ID, DEMO_LIVE_ACCESS_TOKEN,
 * DEMO_LIVE_DISPLAY_NUMBER, DEMO_LOGIN_DOMAIN.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createCipheriv, randomBytes } from 'node:crypto';
import { isDemoMode } from '../../../common/demo-mode';
import {
  DEMO_ADMIN_EMPLOYEE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_AGENT_EMPLOYEE_ID,
  DEMO_AGENT_USER_ID,
  demoAdminEmail,
  demoAgentEmail,
} from '../demo.constants';

function encrypt(plaintext: string): string {
  const hex = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('WHATSAPP_ENCRYPTION_KEY must be 64 hex chars');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), enc.toString('base64'), cipher.getAuthTag().toString('base64')].join(':');
}

async function main(): Promise<void> {
  if (!isDemoMode() && process.env.DEMO_SEED_FORCE !== 'true') {
    throw new Error('Refusing to seed demo accounts outside DEMO_MODE=true (set DEMO_SEED_FORCE=true to override)');
  }
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  const agentPassword = process.env.DEMO_AGENT_PASSWORD;
  if (!adminPassword || !agentPassword) throw new Error('DEMO_ADMIN_PASSWORD and DEMO_AGENT_PASSWORD are required');

  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('no organisation row — run the sync first');
  const superAdmin = await prisma.role.findUnique({ where: { name: 'super_admin' } });
  const admin = await prisma.role.findUnique({ where: { name: 'admin' } });
  const sales = await prisma.role.findUnique({ where: { name: 'sales' } });
  if (!(superAdmin ?? admin) || !sales) throw new Error('roles missing — run the sync first');
  const branch = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' } });
  const salesDept = await prisma.department.findFirst({ where: { name: { equals: 'Sales', mode: 'insensitive' } } });

  const accounts = [
    {
      userId: DEMO_ADMIN_USER_ID,
      employeeId: DEMO_ADMIN_EMPLOYEE_ID,
      email: demoAdminEmail(),
      password: adminPassword,
      roleId: (superAdmin ?? admin)!.id,
      firstName: 'Demo',
      lastName: 'Admin',
      inbox: true,
      code: 'DEMO-ADMIN',
    },
    {
      userId: DEMO_AGENT_USER_ID,
      employeeId: DEMO_AGENT_EMPLOYEE_ID,
      email: demoAgentEmail(),
      password: agentPassword,
      roleId: sales.id,
      firstName: 'Demo',
      lastName: 'Agent',
      inbox: true,
      code: 'DEMO-AGENT',
    },
  ];

  for (const a of accounts) {
    const passwordHash = await bcrypt.hash(a.password, 12);
    await prisma.userAccount.upsert({
      where: { id: a.userId },
      create: { id: a.userId, email: a.email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), mustChangePassword: false },
      update: { email: a.email, passwordHash, status: 'ACTIVE', deletedAt: null, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
    });
    await prisma.userRole.deleteMany({ where: { userId: a.userId } });
    await prisma.userRole.create({ data: { userId: a.userId, roleId: a.roleId } });
    await prisma.employee.upsert({
      where: { id: a.employeeId },
      create: {
        id: a.employeeId,
        userId: a.userId,
        firstName: a.firstName,
        lastName: a.lastName,
        employeeCode: a.code,
        branchId: branch?.id ?? null,
        departmentId: salesDept?.id ?? null,
        isActive: true,
        whatsappInboxMember: a.inbox,
        presenceStatus: 'ONLINE',
        presenceLocked: false,
        joiningDate: new Date(),
      },
      update: {
        firstName: a.firstName,
        lastName: a.lastName,
        isActive: true,
        deletedAt: null,
        whatsappInboxMember: a.inbox,
        presenceStatus: 'ONLINE',
        presenceLocked: false,
        branchId: branch?.id ?? null,
        departmentId: salesDept?.id ?? null,
      },
    });
    console.log(`account ready: ${a.email} (${a.code})`);
  }

  // The demo's own OpenAI key (never the production one).
  const openaiKey = process.env.DEMO_OPENAI_API_KEY;
  if (openaiKey) {
    await prisma.apiKey.updateMany({ where: { organizationId: org.id, provider: 'openai' }, data: { isActive: false } });
    await prisma.apiKey.upsert({
      where: { organizationId_provider_label: { organizationId: org.id, provider: 'openai', label: 'Demo OpenAI' } },
      create: { organizationId: org.id, provider: 'openai', label: 'Demo OpenAI', keyEnc: encrypt(openaiKey), keyTail: openaiKey.slice(-4), isActive: true },
      update: { keyEnc: encrypt(openaiKey), keyTail: openaiKey.slice(-4), isActive: true },
    });
    console.log('openai key stored (…' + openaiKey.slice(-4) + ')');
  } else {
    console.log('DEMO_OPENAI_API_KEY not set — AI key unchanged');
  }

  // Live-lane channel: the demo WhatsApp number a prospect messages.
  const wabaId = process.env.DEMO_LIVE_WABA_ID;
  const phoneNumberId = process.env.DEMO_LIVE_PHONE_NUMBER_ID;
  const accessToken = process.env.DEMO_LIVE_ACCESS_TOKEN;
  const displayNumber = process.env.DEMO_LIVE_DISPLAY_NUMBER;
  if (wabaId && phoneNumberId && accessToken && displayNumber) {
    const allowed = (process.env.DEMO_LIVE_PHONE_NUMBER_IDS ?? '').split(',').map((s) => s.trim());
    if (!allowed.includes(phoneNumberId)) {
      throw new Error(`DEMO_LIVE_PHONE_NUMBER_ID ${phoneNumberId} is not in DEMO_LIVE_PHONE_NUMBER_IDS — outbound would be blocked`);
    }
    await prisma.whatsAppChannel.upsert({
      where: { phoneNumberId },
      create: { label: 'Demo live lane', wabaId, phoneNumberId, displayNumber, accessTokenEnc: encrypt(accessToken), status: 'ACTIVE', tier: 'TIER_1K', platform: 'WHATSAPP' },
      update: { label: 'Demo live lane', wabaId, displayNumber, accessTokenEnc: encrypt(accessToken), status: 'ACTIVE' },
    });
    console.log(`live-lane channel ready: ${displayNumber} (phone_number_id ${phoneNumberId})`);
  } else {
    console.log('DEMO_LIVE_* not fully set — live-lane channel unchanged');
  }

  // The assistant must be on for the live lane.
  await prisma.organization.update({
    where: { id: org.id },
    data: { botMode: 'AUTO', botEnabledAt: org.botEnabledAt ?? new Date('2026-01-01T00:00:00Z') },
  });
  await prisma.$disconnect();
  console.log('demo seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
