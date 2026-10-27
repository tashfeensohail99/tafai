/**
 * One-time bulk transfer of MIS-ROUTED Judicial-Review cases out of Processing
 * and into JR matters.
 *
 * Background: before the finance→JR route existed, a paid JR_RESUBMISSION
 * agreement could be handed to Processing by mistake, creating a ProcessingCase
 * for a file that belongs in the Federal-Court JR department. This script finds
 * those cases, and — for the SAFE and IDLE buckets ONLY (never a case with real
 * work in flight) — opens the JR matter and retires the ProcessingCase, through
 * the REAL JrIntakeService.transferMisroutedCase (matter created in INTAKE, case
 * set to CANCELLED in one transaction, fully idempotent).
 *
 * Buckets (mirrors the SAFE/IDLE split used to triage JR-in-Processing):
 *   • SAFE — stage INTAKE_PENDING, no assigned officer, 0 document items
 *            (checklist not even seeded). Nothing has happened yet.
 *   • IDLE — assigned and/or checklist-seeded but ZERO real work: no submitted
 *            documents, tasks, notes, communications, authority submissions,
 *            inbound documents, or correction requests — AND the stage has not
 *            advanced past DOCUMENTS_COLLECTION.
 *   • ACTIVE — anything else. NEVER touched by this script.
 *
 * DRY-RUN BY DEFAULT: prints the per-case plan and a summary, commits nothing.
 * Pass --commit to actually perform the transfers. Idempotent either way — a
 * case that already has a JrMatter (originCaseId) is skipped.
 *
 *   DRY run:  railway run -s backend npx tsx scripts/transfer-jr-cases-from-processing.ts
 *   Execute:  railway run -s backend npx tsx scripts/transfer-jr-cases-from-processing.ts --commit
 *
 * Optional: TRANSFER_ACTOR_EMAIL=<user@…> chooses the acting user recorded on
 * the matter / stage history / audit. Defaults to the first ACTIVE user holding
 * the `jr.matter.create` permission.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ProcessingCaseStage } from '@prisma/client';
import appConfig from '../src/config/app.config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { NumberingService } from '../src/common/numbering/numbering.service';
import { WhatsAppCryptoService } from '../src/modules/whatsapp/crypto/crypto.service';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';
import { PushService } from '../src/modules/push/push.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { EmailService } from '../src/modules/email/email.service';
import { ActivityTimelineService } from '../src/modules/activity-timeline/activity-timeline.service';
import { AuditLogService } from '../src/modules/audit-log/audit-log.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { LeadAssignmentService } from '../src/modules/lead-assignment/lead-assignment.service';
import { LeadsService } from '../src/modules/leads/leads.service';
import { JrIntakeService } from '../src/modules/judicial-review/jr-intake.service';
import type { RequestUser } from '../src/common/types/auth.types';

/**
 * Minimal module: JrIntakeService + its FULL dependency closure, hand-listed
 * (mirrors ingest-knowledge.ts). We do NOT import the feature modules — that
 * would pull in ImapService's inbound-mail poller and the audit-retention cron
 * (both have onModuleInit side effects), and the full AppModule can't boot
 * outside Railway (its BullMQ queues wait forever for redis.railway.internal).
 * Every service below is a plain @Injectable whose own constructor deps are all
 * present in this list (ConfigService comes from ConfigModule).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [appConfig] })],
  providers: [
    PrismaService,
    NumberingService,
    WhatsAppCryptoService,
    ApiKeysService,
    PushService,
    NotificationsService,
    EmailService,
    ActivityTimelineService,
    AuditLogService,
    StorageService,
    LeadAssignmentService,
    LeadsService,
    JrIntakeService,
  ],
})
class TransferModule {}

// Route this script through the transaction-mode pooler with a single
// connection — the deployed app monopolizes the session-mode pooler (same
// reasoning as ingest-knowledge.ts).
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}

const COMMIT = process.argv.includes('--commit');

// Stages at/below which "no advancement" holds for the IDLE bucket.
const UNADVANCED_STAGES: ProcessingCaseStage[] = [
  ProcessingCaseStage.INTAKE_PENDING,
  ProcessingCaseStage.DOCUMENTS_COLLECTION,
];

// Already-terminal cases are out of scope (a transferred case lands on
// CANCELLED; COMPLETED/JUNK are closed).
const TERMINAL_STAGES: ProcessingCaseStage[] = [
  ProcessingCaseStage.COMPLETED,
  ProcessingCaseStage.CANCELLED,
  ProcessingCaseStage.JUNK,
];

type Bucket = 'SAFE' | 'IDLE' | 'ACTIVE';

async function resolveActor(prisma: PrismaService): Promise<RequestUser> {
  const email = process.env.TRANSFER_ACTOR_EMAIL;
  const base = {
    status: 'ACTIVE' as const,
    deletedAt: null,
  };
  const user = email
    ? await prisma.userAccount.findFirst({ where: { ...base, email } })
    : await prisma.userAccount.findFirst({
        where: {
          ...base,
          userRoles: {
            some: {
              role: { rolePermissions: { some: { permission: { key: 'jr.matter.create' } } } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
  if (!user) {
    throw new Error(
      email
        ? `No ACTIVE user found with email ${email}.`
        : 'No ACTIVE user with the jr.matter.create permission found — set TRANSFER_ACTOR_EMAIL.',
    );
  }
  return { id: user.id, email: user.email, roles: [], permissions: [] };
}

async function main() {
  const app = await NestFactory.createApplicationContext(TransferModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const intake = app.get(JrIntakeService);
  // Touch ConfigService so an unused-import lint never trims it (the module
  // needs ConfigModule for EmailService).
  app.get(ConfigService);

  console.log(`\n=== Transfer JR cases out of Processing — ${COMMIT ? 'COMMIT' : 'DRY RUN'} ===\n`);

  const actor = await resolveActor(prisma);
  console.log(`Acting as: ${actor.email} (${actor.id})\n`);

  // All non-terminal JR-service cases still live in Processing.
  const cases = await prisma.processingCase.findMany({
    where: {
      service: 'JR_RESUBMISSION',
      cancelledAt: null,
      stage: { notIn: TERMINAL_STAGES },
    },
    include: {
      client: { select: { firstName: true, lastName: true, referenceCode: true } },
      _count: {
        select: {
          documentItems: true,
          tasks: true,
          notes: true,
          communications: true,
          submissions: true,
          inboundDocuments: true,
          correctionRequests: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const summary = { SAFE: 0, IDLE: 0, ACTIVE: 0, transferred: 0, skippedExisting: 0, failed: 0 };

  for (const c of cases) {
    // "files" = document items that actually have a submission (not just a
    // seeded, empty checklist row).
    const submittedDocs = await prisma.caseDocumentItem.count({
      where: { caseId: c.id, status: { not: 'NOT_SUBMITTED' } },
    });
    const realWork =
      submittedDocs +
      c._count.tasks +
      c._count.notes +
      c._count.communications +
      c._count.submissions +
      c._count.inboundDocuments +
      c._count.correctionRequests;
    const hasOfficer = Boolean(c.assignedOfficerId);
    const stageUnadvanced = UNADVANCED_STAGES.includes(c.stage);

    let bucket: Bucket;
    if (c.stage === ProcessingCaseStage.INTAKE_PENDING && !hasOfficer && c._count.documentItems === 0) {
      bucket = 'SAFE';
    } else if (stageUnadvanced && realWork === 0) {
      bucket = 'IDLE';
    } else {
      bucket = 'ACTIVE';
    }
    summary[bucket]++;

    const name = `${c.client.firstName} ${c.client.lastName}`.trim();
    const ref = c.client.referenceCode ?? '—';
    const line = `[${bucket}] ${name} · ref ${ref} · case ${c.id} · stage ${c.stage} · work=${realWork}`;

    if (bucket === 'ACTIVE') {
      console.log(`${line}  → SKIP (active work in flight)`);
      continue;
    }

    // Idempotency: already has a JR matter?
    const existing = await prisma.jrMatter.findFirst({
      where: { originCaseId: c.id },
      select: { matterNumber: true },
    });
    if (existing) {
      summary.skippedExisting++;
      console.log(`${line}  → SKIP (already JR matter ${existing.matterNumber})`);
      continue;
    }

    if (!COMMIT) {
      console.log(`${line}  → WOULD transfer to a new JR matter + close the case`);
      continue;
    }

    try {
      const matter = await intake.transferMisroutedCase(c.id, {}, actor);
      summary.transferred++;
      console.log(`${line}  → TRANSFERRED to ${matter.matterNumber} (case closed)`);
    } catch (e) {
      summary.failed++;
      console.error(`${line}  → FAILED: ${(e as Error).message}`);
    }
  }

  console.log(
    `\nSummary: ${cases.length} JR-service case(s) in Processing — ` +
      `SAFE ${summary.SAFE}, IDLE ${summary.IDLE}, ACTIVE ${summary.ACTIVE} (skipped). ` +
      (COMMIT
        ? `Transferred ${summary.transferred}, already-linked ${summary.skippedExisting}, failed ${summary.failed}.`
        : `Would transfer ${summary.SAFE + summary.IDLE - summary.skippedExisting}, already-linked ${summary.skippedExisting}. Re-run with --commit to execute.`),
  );

  await app.close();
  process.exit(summary.failed > 0 ? 1 : 0);
}

void main();
