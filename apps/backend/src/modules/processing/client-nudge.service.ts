/**
 * P5-nudges — Client Nudge Service
 *
 * Proactively sends WhatsApp reminders to clients when their processing case
 * needs attention. Runs as a background sweeper every 6 hours (same pattern as
 * DocumentExpirySweeperService). Each nudge type has a cooldown so clients are
 * not spammed.
 *
 * Nudge types:
 *   DOCS_REQUEST        — CRITICAL/REQUIRED doc still NOT_SUBMITTED on an active case
 *   DOC_REJECTED        — CRITICAL/REQUIRED doc was REJECTED (needs re-upload)
 *   EXPIRY_30D / EXPIRY_7D — accepted doc expiring within 30/7 days
 *   ATTESTATION_REMINDER — doc attestation still REQUIRED_PENDING
 *
 * Delivery: WhatsApp first (clients are most responsive there). If the 24-hour
 * WhatsApp customer-service window is closed — or there's no conversation yet —
 * we fall back to email so the reminder still reaches the client. Each attempt
 * is recorded as a ClientReminder (channel WHATSAPP or EMAIL); a nudge is only
 * logged as FAILED when it can't be delivered on either channel.
 */
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  DocumentAttestationStatus,
  DocumentItemStatus,
  ProcessingCaseStage,
  ReminderChannel,
  ReminderDeliveryStatus,
  ReminderType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProcessingService } from './processing.service';

// ---------- Constants --------------------------------------------------------

/** Cases in these stages can still receive doc-related nudges. */
const NUDGE_ELIGIBLE_STAGES: ProcessingCaseStage[] = [
  ProcessingCaseStage.DOCUMENTS_COLLECTION,
  ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW,
  ProcessingCaseStage.DOCUMENTS_INCOMPLETE,
  ProcessingCaseStage.DOCUMENTS_COMPLETE,
  ProcessingCaseStage.READY_FOR_SUBMISSION,
];

/** Cooldown (ms) between nudges of the same type for the same case. */
const COOLDOWN: Record<ReminderType, number> = {
  DOCS_REQUEST: 72 * 60 * 60 * 1000,       // 72 h
  DOC_REJECTED: 48 * 60 * 60 * 1000,       // 48 h
  EXPIRY_30D: 30 * 24 * 60 * 60 * 1000,    // 30 days (effectively one-shot)
  EXPIRY_7D: 7 * 24 * 60 * 60 * 1000,      // 7 days (effectively one-shot)
  ATTESTATION_REMINDER: 72 * 60 * 60 * 1000, // 72 h
  // Unused types — no cooldown needed (nudge service never sends these)
  WELCOME: 0,
  DOCS_DEADLINE_7D: 0,
  DOCS_DEADLINE_1D: 0,
  DOCS_OVERDUE: 0,
  STAGE_UPDATE: 0,
  SUBMISSION_CONFIRMED: 0,
  DECISION_RECEIVED: 0,
};

/** Max cases processed per sweep to keep each tick fast. */
const BATCH = 100;

// ---------- Service ----------------------------------------------------------

@Injectable()
export class ClientNudgeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ClientNudgeService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly processingService: ProcessingService,
  ) {}

  onModuleInit(): void {
    // Start 2 min after boot (staggered away from the 90s expiry sweeper).
    setTimeout(
      () =>
        void this.sweep().catch((e) =>
          this.log.error(`nudge sweep failed: ${(e as Error).message}`),
        ),
      120_000,
    );
    this.timer = setInterval(() => {
      void this.sweep().catch((e) =>
        this.log.error(`nudge sweep failed: ${(e as Error).message}`),
      );
    }, ClientNudgeService.INTERVAL_MS);
    this.log.log('Client nudge sweeper started (6h interval)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- Main sweep loop -----------------------------------------------

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const now = new Date();
    try {
      const cases = await this.prisma.processingCase.findMany({
        where: { stage: { in: NUDGE_ELIGIBLE_STAGES } },
        select: {
          id: true,
          service: true,
          assignedOfficerId: true,
          lead: { select: { id: true, firstName: true } },
          client: { select: { id: true, firstName: true } },
          documentItems: {
            where: {
              criticality: { in: ['CRITICAL', 'REQUIRED'] },
            },
            select: {
              id: true,
              documentName: true,
              status: true,
              attestationStatus: true,
              validityExpiryDate: true,
              expiryAlertSentAt: true,
              validityRule: true,
            },
          },
        },
        take: BATCH,
      });

      let nudgesSent = 0;
      for (const c of cases) {
        const actorId = c.assignedOfficerId ?? '';
        const firstName =
          c.client?.firstName ?? c.lead?.firstName ?? 'there';
        const service = c.service;

        nudgesSent += await this.nudgeMissingDocs(c.id, firstName, service, actorId, now, c.documentItems);
        nudgesSent += await this.nudgeRejectedDocs(c.id, firstName, service, actorId, now, c.documentItems);
        nudgesSent += await this.nudgeExpiringDocs(c.id, firstName, service, actorId, now, c.documentItems);
        nudgesSent += await this.nudgeAttestationPending(c.id, firstName, service, actorId, now, c.documentItems);
      }

      if (nudgesSent > 0) {
        this.log.log(`nudge sweep: ${nudgesSent} client nudge(s) sent`);
      }
    } finally {
      this.running = false;
    }
  }

  // ---------- Nudge: missing docs -------------------------------------------

  private async nudgeMissingDocs(
    caseId: string,
    firstName: string,
    service: string,
    actorId: string,
    now: Date,
    items: DocItem[],
  ): Promise<number> {
    const missing = items.filter((i) => i.status === DocumentItemStatus.NOT_SUBMITTED);
    if (missing.length === 0) return 0;

    const alreadySent = await this.recentlySent(caseId, ReminderType.DOCS_REQUEST, now);
    if (alreadySent) return 0;

    const list = missing.map((i) => `• ${i.documentName}`).join('\n');
    const body =
      `Hi ${firstName}! This is a reminder from Tashfeen Immigration regarding your ` +
      `${service} case.\n\n` +
      `The following documents are still pending:\n${list}\n\n` +
      `Please upload them via your client portal as soon as possible. ` +
      `Reply here if you need any help.`;

    const subject = `Documents still needed — your ${service} application`;
    return this.send(caseId, body, ReminderType.DOCS_REQUEST, actorId, now, missing.map((i) => i.documentName), subject);
  }

  // ---------- Nudge: rejected docs ------------------------------------------

  private async nudgeRejectedDocs(
    caseId: string,
    firstName: string,
    service: string,
    actorId: string,
    now: Date,
    items: DocItem[],
  ): Promise<number> {
    const rejected = items.filter((i) => i.status === DocumentItemStatus.REJECTED);
    if (rejected.length === 0) return 0;

    const alreadySent = await this.recentlySent(caseId, ReminderType.DOC_REJECTED, now);
    if (alreadySent) return 0;

    const list = rejected.map((i) => `• ${i.documentName}`).join('\n');
    const body =
      `Hi ${firstName}! Some documents in your ${service} case require your attention.\n\n` +
      `Documents that need to be re-submitted:\n${list}\n\n` +
      `Please check the notes in your client portal and re-upload. ` +
      `Reply here if you have any questions.`;

    const subject = `Action needed: documents to re-submit — ${service}`;
    return this.send(caseId, body, ReminderType.DOC_REJECTED, actorId, now, rejected.map((i) => i.documentName), subject);
  }

  // ---------- Nudge: expiring docs ------------------------------------------

  private async nudgeExpiringDocs(
    caseId: string,
    firstName: string,
    service: string,
    actorId: string,
    now: Date,
    items: DocItem[],
  ): Promise<number> {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Only docs with an expiry date and no recent expiry alert
    const expirables = items.filter(
      (i) =>
        i.validityRule !== 'NONE' &&
        i.validityExpiryDate !== null &&
        i.status === DocumentItemStatus.ACCEPTED,
    );

    const urgentDocs = expirables.filter(
      (i) =>
        i.validityExpiryDate! <= in7 &&
        (!i.expiryAlertSentAt ||
          i.expiryAlertSentAt.getTime() < now.getTime() - COOLDOWN.EXPIRY_7D),
    );

    const soonDocs = expirables.filter(
      (i) =>
        i.validityExpiryDate! > in7 &&
        i.validityExpiryDate! <= in30 &&
        (!i.expiryAlertSentAt ||
          i.expiryAlertSentAt.getTime() < now.getTime() - COOLDOWN.EXPIRY_30D),
    );

    let sent = 0;

    if (urgentDocs.length > 0) {
      const list = urgentDocs
        .map((i) => `• ${i.documentName} (expires ${fmtDate(i.validityExpiryDate!)})`)
        .join('\n');
      const body =
        `⚠️ URGENT: Hi ${firstName}! The following documents in your ${service} case ` +
        `expire within 7 days:\n\n${list}\n\n` +
        `Please renew them and upload updated copies immediately to avoid a delay in your application.`;

      const subject = `Urgent: documents expiring within 7 days — ${service}`;
      sent += await this.send(caseId, body, ReminderType.EXPIRY_7D, actorId, now, urgentDocs.map((i) => i.documentName), subject);
      if (sent > 0) {
        // Mark expiryAlertSentAt on each doc
        await this.prisma.caseDocumentItem
          .updateMany({
            where: { id: { in: urgentDocs.map((i) => i.id) } },
            data: { expiryAlertSentAt: now },
          })
          .catch(() => {});
      }
    }

    if (soonDocs.length > 0) {
      const list = soonDocs
        .map((i) => `• ${i.documentName} (expires ${fmtDate(i.validityExpiryDate!)})`)
        .join('\n');
      const body =
        `Hi ${firstName}! A reminder that the following documents in your ${service} case ` +
        `will expire within 30 days:\n\n${list}\n\n` +
        `Please arrange renewal in advance to avoid any disruption to your application.`;

      const subject = `Reminder: documents expiring within 30 days — ${service}`;
      const s = await this.send(caseId, body, ReminderType.EXPIRY_30D, actorId, now, soonDocs.map((i) => i.documentName), subject);
      sent += s;
      if (s > 0) {
        await this.prisma.caseDocumentItem
          .updateMany({
            where: { id: { in: soonDocs.map((i) => i.id) } },
            data: { expiryAlertSentAt: now },
          })
          .catch(() => {});
      }
    }

    return sent;
  }

  // ---------- Nudge: attestation pending ------------------------------------

  private async nudgeAttestationPending(
    caseId: string,
    firstName: string,
    service: string,
    actorId: string,
    now: Date,
    items: DocItem[],
  ): Promise<number> {
    const pending = items.filter(
      (i) => i.attestationStatus === DocumentAttestationStatus.REQUIRED_PENDING,
    );
    if (pending.length === 0) return 0;

    const alreadySent = await this.recentlySent(caseId, ReminderType.ATTESTATION_REMINDER, now);
    if (alreadySent) return 0;

    const list = pending.map((i) => `• ${i.documentName}`).join('\n');
    const body =
      `Hi ${firstName}! The following documents in your ${service} case require ` +
      `attestation before they can be accepted:\n\n${list}\n\n` +
      `Please arrange attestation by the relevant authority (HEC, MOFA, IBCC, etc.) ` +
      `and upload the attested copies. Reply here if you need guidance on which authority to contact.`;

    const subject = `Attestation required — your ${service} documents`;
    return this.send(caseId, body, ReminderType.ATTESTATION_REMINDER, actorId, now, pending.map((i) => i.documentName), subject);
  }

  // ---------- Helpers -------------------------------------------------------

  /**
   * Check whether a nudge of this type was already delivered for this case —
   * on EITHER WhatsApp or email — within the type's cooldown period. Counting
   * both channels means a successful email fallback also suppresses the next
   * WhatsApp attempt, so we never double-nudge across channels.
   */
  private async recentlySent(
    caseId: string,
    type: ReminderType,
    now: Date,
  ): Promise<boolean> {
    const cooldownMs = COOLDOWN[type] ?? 48 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - cooldownMs);
    const recent = await this.prisma.clientReminder.findFirst({
      where: {
        caseId,
        reminderType: type,
        channel: { in: [ReminderChannel.WHATSAPP, ReminderChannel.EMAIL] },
        deliveryStatus: ReminderDeliveryStatus.SENT,
        sentAt: { gt: cutoff },
      },
      select: { id: true },
    });
    return recent !== null;
  }

  /**
   * Deliver one nudge and record a ClientReminder. WhatsApp is tried first
   * (clients are most responsive there); if it can't deliver — 24h window
   * closed, no conversation yet, or an error — we fall back to email so the
   * reminder still reaches the client. Returns 1 if EITHER channel delivered,
   * 0 if both failed.
   */
  private async send(
    caseId: string,
    body: string,
    type: ReminderType,
    actorId: string,
    now: Date,
    docNames: string[],
    subject: string,
  ): Promise<number> {
    // 1) WhatsApp first.
    const wa = await this.processingService
      .sendNudgeWhatsApp(caseId, body, actorId)
      .catch((e: Error) => ({ ok: false as const, reason: e.message }));

    if (wa.ok) {
      await this.record(caseId, type, ReminderChannel.WHATSAPP, now, true, null, docNames, body);
      return 1;
    }

    // 2) WhatsApp could not deliver → email fallback.
    const em = await this.processingService
      .sendCaseEmailToClient(caseId, subject, body)
      .catch((e: Error) => ({ ok: false as const, reason: e.message }));

    if (em.ok) {
      await this.record(caseId, type, ReminderChannel.EMAIL, now, true, null, docNames, body);
      this.log.debug(
        `nudge ${type} for case ${caseId}: WhatsApp unavailable (${wa.reason}) — emailed instead`,
      );
      return 1;
    }

    // 3) Neither channel delivered — record one FAILED row carrying both reasons.
    await this.record(
      caseId,
      type,
      ReminderChannel.EMAIL,
      now,
      false,
      `whatsapp: ${wa.reason ?? 'n/a'}; email: ${em.reason ?? 'n/a'}`,
      docNames,
      body,
    );
    this.log.debug(
      `nudge ${type} for case ${caseId}: not delivered — wa=${wa.reason} email=${em.reason}`,
    );
    return 0;
  }

  /**
   * Persist a ClientReminder row. Best-effort — the send already happened, so
   * a record-keeping failure must not bubble up and block the sweep.
   */
  private async record(
    caseId: string,
    type: ReminderType,
    channel: ReminderChannel,
    now: Date,
    sent: boolean,
    errorMessage: string | null,
    docNames: string[],
    body: string,
  ): Promise<void> {
    await this.prisma.clientReminder
      .create({
        data: {
          caseId,
          reminderType: type,
          channel,
          scheduledAt: now,
          sentAt: sent ? now : undefined,
          deliveryStatus: sent
            ? ReminderDeliveryStatus.SENT
            : ReminderDeliveryStatus.FAILED,
          renderedContent: JSON.stringify({ docNames, body: body.slice(0, 500) }),
          errorMessage,
        },
      })
      .catch(() => {
        /* record-keeping is best-effort; the send already happened */
      });
  }
}

// ---------- Local types ------------------------------------------------------

interface DocItem {
  id: string;
  documentName: string;
  status: DocumentItemStatus;
  attestationStatus: DocumentAttestationStatus;
  validityExpiryDate: Date | null;
  expiryAlertSentAt: Date | null;
  validityRule: string;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
