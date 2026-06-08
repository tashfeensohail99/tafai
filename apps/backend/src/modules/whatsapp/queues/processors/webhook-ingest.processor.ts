import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import {
  FollowUpPriority,
  LeadStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { generateLeadReferenceCode } from '../../../../common/reference-codes/reference-codes';
import { ActivityTimelineService } from '../../../activity-timeline/activity-timeline.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { WhatsAppAssignmentService } from '../../routing/assignment.service';
import { WhatsAppRealtimePublisher } from '../../realtime/publisher.service';
import { computeSlaDeadline, type BusinessHours } from '../../routing/business-hours';
import {
  WHATSAPP_QUEUE,
  WHATSAPP_WS_EVENTS,
  type MediaDownloadJob,
  type OutboundMessageJob,
  type WebhookIngestJob,
} from '../queue-contracts';
import { META_LEADGEN_QUEUE, type MetaLeadgenJob } from '../../../meta-leads/queue-contracts';
import type { AiReplyJob } from '../queue-contracts';
import { WhatsAppMessageType as WAMessageType } from '@prisma/client';

// ---- Meta webhook payload types (subset; full spec at developers.facebook.com)
interface MetaContact {
  wa_id: string;
  profile?: { name?: string };
}
/**
 * Click-to-WhatsApp ad attribution block. Meta sends this on the FIRST
 * inbound message after a customer clicks a WhatsApp ad on Facebook /
 * Instagram. Every field is technically optional in the spec but the
 * permissive shape lets us persist whatever Meta sends without losing
 * information that isn't on our typed list.
 * See: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#received-message-triggered-by-click-to-whatsapp-ads
 */
interface MetaReferral {
  source_url?: string;
  source_id?: string;
  source_type?: 'ad' | 'post' | string;
  headline?: string;
  body?: string;
  media_type?: 'image' | 'video' | string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
}
interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  video?: { id: string; mime_type: string; sha256: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown;
  interactive?: unknown;
  context?: { id: string; from?: string };
  reaction?: { message_id: string; emoji: string };
  referral?: MetaReferral;
}
interface MetaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: { id: string; expiration_timestamp?: string; origin?: { type: string } };
  pricing?: { category?: string };
  errors?: Array<{ code: number; title?: string; message?: string; error_data?: unknown }>;
}
// Inbound call event (Meta Calling API, webhook field 'calls').
interface MetaCall {
  id: string;
  from?: string;
  to?: string;
  event?: string; // 'connect' (incoming; carries the SDP offer) | 'ringing' | 'terminate'
  timestamp?: string;
  direction?: string; // 'USER_INITIATED' for inbound
  session?: { sdp?: string; sdp_type?: string };
}
interface MetaValue {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  calls?: MetaCall[];
}
interface MetaChange {
  field: string;
  value: MetaValue;
}
interface MetaEntry {
  id: string;
  changes: MetaChange[];
}
interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: MetaEntry[];
}

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * The system's hottest code path: every inbound WhatsApp event lands here.
 *
 * For each `message` entry we:
 *   1. Find the channel by phone_number_id.
 *   2. Resolve the customer:
 *        a. Existing Client by phone? (already converted — chat continues)
 *        b. Existing Lead by phone?  (active sales prospect — continue)
 *        c. Neither?                 → create a new Lead (sourceChannel=whatsapp)
 *   3. Upsert the WhatsAppThread (24h window timestamp, lastMessage*, unread++).
 *   4. Dedupe-write the WhatsAppMessage (waMessageId is uniq).
 *   5. Record ActivityTimeline event WHATSAPP_MESSAGE_RECEIVED on the Lead/Client.
 *   6. Trigger assignment (sticky → round-robin → after-hours queue).
 *   7. Publish realtime fanout to the org's agents.
 *
 * For each `status` we:
 *   1. Find the Message by waMessageId.
 *   2. Update lifecycle timestamps + status field.
 *   3. Capture error detail if FAILED.
 *   4. Publish realtime fanout.
 */
@Processor(WHATSAPP_QUEUE.WEBHOOK_INGEST, { concurrency: 8 })
export class WebhookIngestProcessor extends WorkerHost {
  private readonly log = new Logger(WebhookIngestProcessor.name);

  /**
   * Per-phone in-process serialization for customer resolution. The webhook
   * worker runs at concurrency 8 in a SINGLE process, so two messages from a
   * brand-new contact arriving together would both find "no existing lead" and
   * both create one — producing a duplicate orphan lead with no thread. This
   * map chains async critical sections per phone so the same contact resolves
   * one-at-a-time; different phones still run fully in parallel.
   *
   * Chosen over a DB lock deliberately: no raw SQL, no schema/migration, no new
   * failure surface (a botched raw lock is exactly what caused the recent
   * outage). Valid for the single backend instance we run today; if we ever
   * scale to multiple replicas, replace this with pg_advisory_xact_lock(phone).
   */
  private readonly phoneLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: ActivityTimelineService,
    private readonly notifications: NotificationsService,
    private readonly assignment: WhatsAppAssignmentService,
    private readonly publisher: WhatsAppRealtimePublisher,
    // Used to enqueue a re-host job for every inbound media (image / video
    // / audio / document / sticker). Meta's CDN URLs expire ~5 min, so we
    // copy the bytes to our own S3 bucket on first sight and persist the
    // permanent URL on the message row. Without this, viewing old media
    // becomes a roulette of "is the channel token still decryptable AND
    // is Meta still hosting this asset" — both of which fail in practice.
    @InjectQueue(WHATSAPP_QUEUE.MEDIA_DOWNLOAD)
    private readonly mediaQueue: Queue<MediaDownloadJob>,
    // Used to dispatch the personalised auto-acknowledgement reply.
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
    // Meta Lead Ads ride the same webhook/app as WhatsApp; we fork their
    // `page`/`leadgen` events onto this queue (handled by the meta-leads module).
    @InjectQueue(META_LEADGEN_QUEUE)
    private readonly metaLeadgenQueue: Queue<MetaLeadgenJob>,
    // AI bot — every TEXT inbound enqueues a delayed reply job (60s) here
    // so a human can jump in first. The processor at the other end double-
    // checks every guard at fire-time.
    @InjectQueue(WHATSAPP_QUEUE.AI_REPLY)
    private readonly aiReplyQueue: Queue<AiReplyJob>,
  ) {
    super();
  }

  override async process(job: Job<WebhookIngestJob>): Promise<void> {
    const { webhookEventId } = job.data;
    const event = await this.prisma.whatsAppWebhookEvent.findUnique({
      where: { id: webhookEventId },
    });
    if (!event) {
      this.log.warn(`webhook event ${webhookEventId} not found`);
      return;
    }
    if (event.processedAt) return; // idempotent
    if (!event.signatureValid) {
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), processingError: 'invalid signature' },
      });
      return;
    }

    const payload = event.rawPayload as unknown as MetaWebhookPayload;

    // Meta Lead Ads arrive on the SAME app + callback URL as WhatsApp (Meta
    // allows only one webhook URL per app) but with object='page' and a
    // 'leadgen' change. Fork those onto the meta-leadgen queue instead of
    // dropping them as "unsupported".
    if ((payload as { object?: string })?.object === 'page') {
      try {
        await this.metaLeadgenQueue.add(
          'leadgen',
          { webhookEventId },
          { jobId: `leadgen-${webhookEventId}` },
        );
      } catch (err) {
        // Don't mark processed — let BullMQ retry the ingest so the lead isn't lost.
        this.log.error(`failed to enqueue leadgen job for ${webhookEventId}: ${(err as Error).message}`);
        throw err;
      }
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      return;
    }

    if (payload?.object !== 'whatsapp_business_account') {
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), processingError: 'unsupported object' },
      });
      return;
    }

    try {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field === 'messages') {
            await this.handleValue(change.value);
          } else if (change.field === 'calls') {
            // Inbound WhatsApp voice call (Meta Calling API).
            await this.handleCallsValue(change.value);
          }
        }
      }
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      this.log.error(`webhook ${webhookEventId} failed: ${(err as Error).message}`);
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), processingError: (err as Error).message },
      });
      throw err; // let BullMQ retry
    }
  }

  private async handleValue(value: MetaValue): Promise<void> {
    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId: value.metadata.phone_number_id },
    });
    if (!channel) {
      this.log.warn(`no channel for phone_number_id ${value.metadata.phone_number_id}`);
      return;
    }

    for (const msg of value.messages ?? []) {
      const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
      await this.ingestInboundMessage(channel.id, msg, profileName ?? null);
    }
    for (const st of value.statuses ?? []) {
      await this.ingestStatus(st);
    }
  }

  /**
   * Run an async critical section serialized per key, in-process. Different
   * keys run concurrently; the same key runs strictly one-at-a-time via a
   * promise chain. The lock is ALWAYS released in `finally`, so a throw inside
   * `fn` can never deadlock the phone (the error still propagates to the
   * caller). The map entry is dropped once nobody is queued behind us, so the
   * map stays bounded to currently in-flight phones.
   */
  private async withPhoneLock<T>(phone: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.phoneLocks.get(phone) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The next caller for this phone waits on `mine` (resolved in our finally).
    const chained = prior.then(() => mine);
    this.phoneLocks.set(phone, chained);
    await prior.catch(() => undefined); // wait our turn; never inherit prior errors
    try {
      return await fn();
    } finally {
      release();
      // Only the last-in-line clears the entry; if someone chained after us
      // they own the key now.
      if (this.phoneLocks.get(phone) === chained) {
        this.phoneLocks.delete(phone);
      }
    }
  }

  /**
   * Inbound WhatsApp **calls** (Meta Calling API, `field: 'calls'`). Phase 0:
   * we don't answer live yet — we make sure the call is never missed. On the
   * customer-initiated `connect` event we resolve the caller (client > lead >
   * new lead), run the SAME assignment engine as messages, log a Call row, and
   * create a HIGH-priority callback FollowUp + a bell Notification for the
   * assigned rep. `terminate` closes the row. (Live in-browser answering is
   * Phase 1.)
   */
  private async handleCallsValue(value: MetaValue): Promise<void> {
    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId: value.metadata.phone_number_id },
    });
    if (!channel) {
      this.log.warn(`no channel for phone_number_id ${value.metadata.phone_number_id} (call)`);
      return;
    }
    for (const call of value.calls ?? []) {
      try {
        await this.ingestInboundCall(channel.id, call);
      } catch (err) {
        this.log.error(`call ingest failed for ${call.id}: ${(err as Error).message}`);
      }
    }
  }

  private async ingestInboundCall(channelId: string, call: MetaCall): Promise<void> {
    const now = new Date();

    // Terminal event — the caller (or Meta) ended the call. Close the row out
    // with the right status + duration, and tell the assigned rep's CallDock to
    // tear down (whether it was still ringing or already in-call). This is the
    // Phase-1b fix for "the customer hangs up but the rep's dock stays open".
    if (call.event === 'terminate') {
      const existing = await this.prisma.whatsAppCall.findUnique({
        where: { waCallId: call.id },
        select: {
          id: true,
          status: true,
          startedAt: true,
          assignedEmployeeId: true,
          direction: true,
          threadId: true,
          channelId: true,
          leadId: true,
          clientId: true,
        },
      });
      if (!existing) return;
      const answered = existing.status === 'ANSWERED';
      await this.prisma.whatsAppCall.update({
        where: { id: existing.id },
        data: {
          status: answered ? 'ENDED' : 'MISSED',
          event: 'terminate',
          endedAt: now,
          durationSeconds:
            answered && existing.startedAt
              ? Math.max(0, Math.round((now.getTime() - existing.startedAt.getTime()) / 1000))
              : undefined,
        },
      });
      if (existing.assignedEmployeeId) {
        await this.publisher.publishToEmployee(
          existing.assignedEmployeeId,
          WHATSAPP_WS_EVENTS.CALL_ENDED,
          { callId: existing.id },
        );
      }
      // Inbound call that was never answered → invite the caller to book a
      // time so the AI bot can schedule a callback/appointment. Guarded by the
      // 24h window + per-hour dedupe inside the helper. Outbound calls (a rep
      // dialling out) never trigger a "we missed your call" message.
      if (!answered && existing.direction === 'INBOUND' && existing.threadId) {
        await this.maybeSendMissedCallInvite({
          threadId: existing.threadId,
          channelId: existing.channelId,
          leadId: existing.leadId,
          clientId: existing.clientId,
          waCallId: call.id,
        });
      }
      return;
    }
    // Look up any existing row for this call id up front — it tells us whether
    // this is the answer to an OUTBOUND call we placed, and dedupes inbound.
    const existingRow = await this.prisma.whatsAppCall.findUnique({
      where: { waCallId: call.id },
      select: { id: true, direction: true, assignedEmployeeId: true },
    });

    // Business-initiated (OUTBOUND) connect = the user ACCEPTED a call we
    // placed; this webhook carries their SDP ANSWER. Relay it to the initiating
    // rep's browser (which applies it as the remote description) and mark the
    // call answered. Never create a lead/thread or ring anyone here.
    if (
      call.event === 'connect' &&
      (call.direction === 'BUSINESS_INITIATED' || existingRow?.direction === 'OUTBOUND')
    ) {
      if (!existingRow) {
        this.log.warn(`outbound connect for unknown call ${call.id}`);
        return;
      }
      const answerSdp = call.session?.sdp ?? null;
      await this.prisma.whatsAppCall.update({
        where: { id: existingRow.id },
        data: {
          status: 'ANSWERED',
          sdpAnswer: answerSdp ?? undefined,
          event: 'connect',
          startedAt: new Date(),
        },
      });
      if (existingRow.assignedEmployeeId && answerSdp) {
        await this.publisher.publishToEmployee(
          existingRow.assignedEmployeeId,
          WHATSAPP_WS_EVENTS.CALL_ANSWERED,
          { callId: existingRow.id, sdpAnswer: answerSdp },
        );
      }
      return;
    }

    // From here only INBOUND (user-initiated) "connect" events matter.
    if (call.event && call.event !== 'connect') return;

    const waContactId = call.from;
    if (!waContactId) return;
    const phone = waContactId.startsWith('+') ? waContactId : `+${waContactId}`;

    // Dedupe — Meta retries webhooks; one Call row per waCallId.
    if (existingRow) {
      this.log.debug(`dedup call ${call.id}`);
      return;
    }

    // Resolve customer: client > lead > new lead (same identity rule as
    // messages), serialized per-phone so a simultaneous first message + call
    // can't both create a lead.
    const { leadId, clientId } = await this.withPhoneLock(phone, async () => {
      const existingClient = await this.prisma.client.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
      if (existingClient) {
        return { leadId: null as string | null, clientId: existingClient.id as string | null };
      }
      const existingLead = await this.prisma.lead.findFirst({
        where: { phone, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (existingLead) {
        return { leadId: existingLead.id as string | null, clientId: null as string | null };
      }
      const branch = await this.prisma.branch.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const { firstName, lastName } = splitProfileName(null, phone);
      const referenceCode = await generateLeadReferenceCode(this.prisma);
      const newLead = await this.prisma.lead.create({
        data: {
          referenceCode,
          firstName,
          lastName,
          phone,
          sourceChannel: 'whatsapp',
          status: LeadStatus.NEW,
          ...(branch ? { branchId: branch.id } : {}),
        },
        select: { id: true },
      });
      return { leadId: newLead.id as string | null, clientId: null as string | null };
    });

    // Upsert the contact's thread so the call shares the inbox conversation and
    // we can reuse the assignment engine.
    const thread = await this.prisma.whatsAppThread.upsert({
      where: { channelId_waContactId: { channelId, waContactId } },
      create: {
        channelId,
        leadId,
        clientId,
        waContactId,
        firstInboundAt: now,
        lastMessageAt: now,
        lastMessagePreview: '📞 Incoming call',
        unreadCount: 1,
      },
      update: {
        ...(leadId && { leadId }),
        ...(clientId && { clientId }),
        lastMessageAt: now,
        lastMessagePreview: '📞 Incoming call',
        unreadCount: { increment: 1 },
        status: 'OPEN',
      },
    });

    const callRow = await this.prisma.whatsAppCall.create({
      data: {
        threadId: thread.id,
        channelId,
        leadId,
        clientId,
        waCallId: call.id,
        direction: 'INBOUND',
        status: 'RINGING',
        event: call.event ?? 'connect',
        // SDP offer for the rep's browser to answer (Phase 1 live softphone).
        sdpOffer: call.session?.sdp ?? null,
        startedAt: now,
      },
      select: { id: true },
    });

    // Same routing engine as inbound messages: sticky → round-robin. For a LIVE
    // call we pass forLiveCall so it never drops to "unassigned" when nobody is
    // ONLINE — it rings the next available rep (one rep) instead of nobody.
    try {
      await this.assignment.ensureAssigned(thread.id, { forLiveCall: true });
    } catch (err) {
      this.log.error(`call assignment failed for thread ${thread.id}: ${(err as Error).message}`);
    }

    // Route to the assigned rep: a lead-scoped callback task + a bell ping.
    try {
      const t = await this.prisma.whatsAppThread.findUnique({
        where: { id: thread.id },
        select: {
          lead: {
            select: { id: true, firstName: true, lastName: true, phone: true, assignedEmployeeId: true },
          },
        },
      });
      const lead = t?.lead ?? null;
      const assignedEmployeeId = lead?.assignedEmployeeId ?? null;
      if (assignedEmployeeId) {
        await this.prisma.whatsAppCall.updateMany({
          where: { waCallId: call.id },
          data: { assignedEmployeeId },
        });
        const emp = await this.prisma.employee.findUnique({
          where: { id: assignedEmployeeId },
          select: { user: { select: { id: true } } },
        });
        const userId = emp?.user?.id ?? null;
        const who = `${lead?.firstName ?? ''} ${lead?.lastName ?? ''}`.trim() || lead?.phone || phone;
        if (lead?.id && userId) {
          await this.prisma.followUp.create({
            data: {
              leadId: lead.id,
              assignedEmployeeId,
              createdByUserId: userId,
              title: `Call back ${who}`,
              description: `Missed WhatsApp call from ${phone} — call them back.`,
              contactMethod: 'WHATSAPP',
              dueAt: now,
              priority: FollowUpPriority.HIGH,
            },
          });
        }
        if (userId) {
          await this.notifications.create({
            userId,
            type: 'WHATSAPP_CALL',
            title: `📞 WhatsApp call from ${who}`,
            body: phone,
            link: lead?.id ? `/sales/leads/${lead.id}` : '/sales/inbox',
          });
        }
        // Phase 1: ring THIS rep's browser (CallDock). Per-employee channel, so
        // only the assigned rep's open tabs ring — not every agent in the org.
        await this.publisher.publishToEmployee(
          assignedEmployeeId,
          WHATSAPP_WS_EVENTS.CALL_INCOMING,
          {
            callId: callRow.id,
            from: phone,
            leadId: lead?.id ?? null,
            leadName: who,
            threadId: thread.id,
          },
        );
      }
    } catch (err) {
      this.log.warn(`call routing/notify failed for ${call.id}: ${(err as Error).message}`);
    }
  }

  private async ingestInboundMessage(
    channelId: string,
    msg: MetaMessage,
    profileName: string | null,
  ): Promise<void> {
    const waContactId = msg.from;
    const phone = waContactId.startsWith('+') ? waContactId : `+${waContactId}`;
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

    // Resolve customer: client > lead > new lead. We treat phone match as
    // identity. Phone has a UNIQUE constraint on Client and an index on Lead.
    //
    // The whole resolution runs under a per-phone in-process lock so two
    // messages from the SAME brand-new contact arriving together can't both
    // pass the "no existing lead" check and both create a lead (the duplicate
    // orphan-lead race). The second job waits, then finds the lead the first
    // one just created. Different phones lock on different keys and don't wait.
    const { leadId, clientId, createdLead } = await this.withPhoneLock(phone, async () => {
      const existingClient = await this.prisma.client.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
      let leadId: string | null = null;
      const clientId: string | null = existingClient?.id ?? null;
      let createdLead = false;

      if (!clientId) {
        const existingLead = await this.prisma.lead.findFirst({
          where: { phone, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (existingLead) {
          leadId = existingLead.id;
        } else {
          // Create a new Lead from the WhatsApp profile. Required fields:
          // firstName, lastName, phone. branchId optional but we pick the
          // first branch of the (single) Organization for proper bucketing.
          const branch = await this.prisma.branch.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          const { firstName, lastName } = splitProfileName(profileName, phone);
          // Auto-created leads from inbound WhatsApp need the same
          // referenceCode treatment as Sales-created leads — anything
          // missing the column would fail the new NOT NULL constraint.
          const referenceCode = await generateLeadReferenceCode(this.prisma);
          const newLead = await this.prisma.lead.create({
            data: {
              referenceCode,
              firstName,
              lastName,
              phone,
              sourceChannel: 'whatsapp',
              status: LeadStatus.NEW,
              ...(branch ? { branchId: branch.id } : {}),
            },
            select: { id: true },
          });
          leadId = newLead.id;
          createdLead = true;
        }
      }
      return { leadId, clientId, createdLead };
    });

    // Click-to-WhatsApp ad referral. Meta only sends this on the first
    // message after a customer clicks the ad — store it on both the
    // thread (so the inbox can show "replied from <ad>" on subsequent
    // messages too) and on the message itself (so we can ledger which
    // exact reply each ad produced).
    const referral = msg.referral
      ? (msg.referral as unknown as Prisma.InputJsonValue)
      : undefined;
    const adReferralUpdate = referral
      ? { adReferral: referral, adReferralAt: now }
      : {};

    // Upsert thread by (channelId, waContactId). Both indexes exist.
    const thread = await this.prisma.whatsAppThread.upsert({
      where: { channelId_waContactId: { channelId, waContactId } },
      create: {
        channelId,
        leadId,
        clientId,
        waContactId,
        windowExpiresAt,
        firstInboundAt: now,
        lastMessageAt: now,
        lastMessagePreview: previewOf(msg),
        unreadCount: 1,
        // Pending: a customer message just arrived → awaiting a human reply.
        lastCustomerMessageAt: now,
        awaitingReply: true,
        ...adReferralUpdate,
      },
      update: {
        // Keep linkage in sync (covers lead-to-client conversion).
        ...(leadId && { leadId }),
        ...(clientId && { clientId }),
        windowExpiresAt,
        lastMessageAt: now,
        lastMessagePreview: previewOf(msg),
        unreadCount: { increment: 1 },
        // Pending: a customer message just arrived → awaiting a human reply.
        // (A bot auto-reply afterwards does NOT clear this — only a manual send.)
        lastCustomerMessageAt: now,
        awaitingReply: true,
        status: 'OPEN',
        // Stamp firstInboundAt only if missing.
        firstInboundAt: undefined,
        // Overwrite to the latest ad they came through. If they didn't
        // click an ad this time the spread is {} and the previous
        // attribution is preserved.
        ...adReferralUpdate,
      },
    });

    // If this is the conversation's first inbound and firstInboundAt is still
    // null (existing thread that we previously created for outbound), stamp it.
    if (!thread.firstInboundAt) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { firstInboundAt: now },
      });
    }

    // Dedupe: Meta retries every webhook with the same wa_message_id.
    const dupe = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.id },
      select: { id: true },
    });
    if (dupe) {
      this.log.debug(`dedup inbound ${msg.id}`);
      return;
    }

    const decoded = decodeIncoming(msg);
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId,
        leadId,
        clientId,
        waMessageId: msg.id,
        direction: WhatsAppMessageDirection.INBOUND,
        type: decoded.type,
        status: WhatsAppMessageStatus.RECEIVED,
        body: decoded.body,
        payload: decoded.payload as Prisma.InputJsonValue,
        mediaMimeType: decoded.mediaMeta?.mime_type ?? null,
        repliedToWaMessageId: msg.context?.id ?? null,
        // Pin the click-to-WhatsApp ad attribution to the exact reply that
        // arrived from the ad click. Subsequent replies from the same
        // contact won't have it (Meta only sends `referral` once per
        // click); the thread-level adReferral covers that case for the UI.
        ...(referral ? { adReferral: referral } : {}),
        createdAt: new Date(Number(msg.timestamp) * 1000),
      },
    });

    // For media types (image / video / audio / document / sticker) the
    // payload contains a Meta media ID whose CDN URL is short-lived
    // (~5 min). Enqueue a re-host job so MediaDownloadProcessor pulls the
    // bytes once and stores them on our own bucket, then sets
    // `mediaUrl` to the durable S3 key. Without this, viewing the media
    // later in the inbox depends on the channel token still being
    // decryptable AND Meta still hosting the asset — both fail in
    // practice (token rotation kills the first, ~30d retention kills the
    // second). jobId is stable so duplicate webhooks dedupe naturally.
    if (decoded.mediaMeta) {
      const job: MediaDownloadJob = {
        messageId: message.id,
        metaMediaId: decoded.mediaMeta.id,
      };
      try {
        await this.mediaQueue.add('download', job, {
          jobId: `media-${message.id}`,
          removeOnComplete: { count: 100, age: 24 * 3600 },
          removeOnFail: { count: 100 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        });
      } catch (err) {
        // Enqueue failure shouldn't block the rest of the ingest flow —
        // the message row is already persisted; worst case the media
        // stays un-rehosted and falls back to streamMedia on-demand.
        this.log.warn(
          `media-download enqueue failed for ${message.id}: ${(err as Error).message}`,
        );
      }
    }

    // Activity timeline — Lead-rooted or Client-rooted depending on linkage.
    await this.timeline.record({
      entityType: clientId ? 'Client' : 'Lead',
      entityId: (clientId ?? leadId)!,
      leadId: leadId ?? undefined,
      clientId: clientId ?? undefined,
      eventType: createdLead ? 'WHATSAPP_LEAD_CREATED' : 'WHATSAPP_MESSAGE_RECEIVED',
      description: createdLead
        ? `New WhatsApp lead from ${phone}`
        : `WhatsApp message received: ${(decoded.body ?? '[' + decoded.type.toLowerCase() + ']').slice(0, 80)}`,
      metadata: {
        channelId,
        threadId: thread.id,
        messageId: message.id,
        type: decoded.type,
      },
    });

    // Run assignment engine: sticky → round-robin → after-hours queue.
    try {
      await this.assignment.ensureAssigned(thread.id);
    } catch (err) {
      this.log.error(`assignment failed for thread ${thread.id}: ${(err as Error).message}`);
    }

    // Response-SLA clock + auto-acknowledgement. Runs AFTER assignment so the
    // auto-ack can name the agent the lead was just routed to. Non-fatal —
    // a failure here must never drop the inbound message we already saved.
    try {
      await this.startResponseClockAndAutoAck(thread.id);
    } catch (err) {
      this.log.error(
        `response-SLA/auto-ack failed for thread ${thread.id}: ${(err as Error).message}`,
      );
    }

    // Realtime fanout to all agents in the org.
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (org) {
      await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_NEW, {
        threadId: thread.id,
        leadId,
        clientId,
        messageId: message.id,
        direction: 'INBOUND',
      });
    }

    // Bell notification for the assigned agent. Fired after assignment +
    // SLA so the routing decisions are settled. Best-effort — failures here
    // never block ingest. We re-read the thread (instead of using the
    // closure-captured value) because ensureAssigned() may have just
    // populated assignedEmployeeId. WhatsAppThread has no `assignedEmployee`
    // relation defined in the schema, so we look up the Employee by id in
    // a separate hop.
    try {
      const assigned = await this.prisma.whatsAppThread.findUnique({
        where: { id: thread.id },
        select: {
          // The assignee lives on the Lead, not the thread (WhatsAppThread has
          // neither an assignedEmployeeId scalar nor an assignedEmployee
          // relation). Selecting it at the thread level threw on every inbound,
          // silently killing the bell notification.
          lead: { select: { firstName: true, phone: true, assignedEmployeeId: true } },
        },
      });
      const assignedEmployeeId = assigned?.lead?.assignedEmployeeId ?? null;
      if (assignedEmployeeId) {
        const emp = await this.prisma.employee.findUnique({
          where: { id: assignedEmployeeId },
          select: { user: { select: { id: true } } },
        });
        const userId = emp?.user?.id;
        if (userId) {
          const who = (assigned?.lead?.firstName ?? assigned?.lead?.phone ?? 'WhatsApp lead').trim();
          const preview = (decoded.body ?? `[${decoded.type.toLowerCase()}]`).slice(0, 80);
          await this.notifications.create({
            userId,
            type: 'WHATSAPP_MESSAGE',
            title: `New WhatsApp from ${who}`,
            body: preview,
            link: '/sales/inbox',
          });
        }
      }
    } catch (err) {
      this.log.warn(`bell notification failed for thread ${thread.id}: ${(err as Error).message}`);
    }

    // AI bot — enqueue a delayed reply job (60s) so a human has a chance to
    // jump in first. The AiReplyProcessor at the other end re-checks every
    // guard at fire-time (newer inbound, human-active window, paid client,
    // etc.). Fully try/caught — AI failure must never block ingest.
    //
    // Eligible message types:
    //   • TEXT with a body — straightforward.
    //   • AUDIO — voice notes. The AI processor pulls the rehosted audio
    //     bytes, runs Whisper, writes the transcript into message.body and
    //     hands the transcript to the orchestrator. Reply is text either way.
    //   • IMAGE / DOCUMENT — bot doesn't try to read the file; it sends one
    //     canned "got it, manager will review" acknowledgement and parks
    //     the thread in HANDED_OFF so it doesn't keep replying.
    const isText = decoded.type === WAMessageType.TEXT && decoded.body && decoded.body.trim().length >= 2;
    const isAudio = decoded.type === WAMessageType.AUDIO;
    const isMediaForAck =
      decoded.type === WAMessageType.IMAGE || decoded.type === WAMessageType.DOCUMENT;
    if (isText || isAudio || isMediaForAck) {
      try {
        await this.aiReplyQueue.add(
          'reply',
          {
            inboundMessageId: message.id,
            threadId: thread.id,
            // For AUDIO, body is empty here — the AI processor transcribes
            // first and uses that. Keep the field non-nullable so the queue
            // contract stays clean.
            body: decoded.body ?? '',
          },
          {
            jobId: `ai-${message.id}`, // idempotent on retries / dupes
            delay: 60_000,             // 60-second debounce
            attempts: 2,
            removeOnComplete: { age: 3600, count: 500 },
            removeOnFail: { age: 24 * 3600, count: 500 },
          },
        );
      } catch (err) {
        this.log.error(
          `AI reply enqueue failed for message ${message.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * After an inbound message is saved + assigned:
   *  1. Start the rolling Response-SLA clock if it's freshly the agent's turn
   *     (responseDeadlineAt was null). If a clock is already running we leave
   *     it — the earliest unanswered message owns the deadline, so a customer
   *     firing off three messages doesn't get three clocks or a reset.
   *  2. Send the personalised auto-acknowledgement once per thread. The
   *     auto-ack is flagged in its payload so the outbound worker does NOT
   *     treat it as the agent's reply — the SLA keeps running until a human
   *     actually responds.
   */
  private async startResponseClockAndAutoAck(threadId: string): Promise<void> {
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        waContactId: true,
        responseDeadlineAt: true,
        autoAckSentAt: true,
        lead: {
          select: {
            firstName: true,
            assignedEmployee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!thread) return;

    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!org) return;

    const now = new Date();
    const hours: BusinessHours = {
      timezone: org.timezone,
      hoursOpen: org.hoursOpen,
      hoursClose: org.hoursClose,
      workingDays: org.workingDays,
      breakStart: org.breakStart,
      breakEnd: org.breakEnd,
    };

    // 1) Start the response clock only if not already awaiting a reply.
    if (!thread.responseDeadlineAt) {
      const deadline = computeSlaDeadline(hours, now, org.slaResponseSeconds);
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: {
          responseDeadlineAt: deadline,
          responseDueSince: now,
          responseWarned: false,
          responseBreached: false,
        },
      });
    }

    // 2) Auto-acknowledgement — once per thread, when enabled and the lead has
    //    a named assignee to greet them by.
    //
    //    Concurrency: the webhook worker runs at concurrency 8, so a customer
    //    firing off two messages in the same second (or Meta re-delivering)
    //    spawns two process() runs for the SAME thread. A read-then-write
    //    `!autoAckSentAt` check let both pass → two greetings (the bug). We
    //    now CLAIM the ack atomically: updateMany gated on autoAckSentAt:null
    //    only flips one row, so exactly one run wins and sends.
    const agent = thread.lead?.assignedEmployee;
    if (org.autoAckEnabled && org.autoAckTemplate && agent && thread.leadId) {
      const claim = await this.prisma.whatsAppThread.updateMany({
        where: { id: thread.id, autoAckSentAt: null },
        data: { autoAckSentAt: now },
      });
      if (claim.count === 1) {
        // WhatsApp leads with no profile name are created as firstName
        // "WhatsApp" — don't greet someone as "Hey WhatsApp!". Fall back to a
        // neutral "there".
        const raw = thread.lead?.firstName?.trim() ?? '';
        const firstName = !raw || raw.toLowerCase() === 'whatsapp' ? 'there' : raw;
        const body = org.autoAckTemplate
          .replaceAll('{firstName}', firstName)
          .replaceAll('{agentName}', agent.firstName)
          .replaceAll('{businessName}', org.name);

        const ack = await this.prisma.whatsAppMessage.create({
          data: {
            threadId: thread.id,
            channelId: thread.channelId,
            leadId: thread.leadId,
            clientId: thread.clientId,
            direction: WhatsAppMessageDirection.OUTBOUND,
            type: WhatsAppMessageType.TEXT,
            status: WhatsAppMessageStatus.QUEUED,
            body,
            // System message — sentByEmployeeId null; payload flag tells the
            // outbound worker to skip SLA resolution for this send.
            payload: { autoAck: true } as unknown as Prisma.InputJsonValue,
            // Deterministic key — a second layer: even if two runs somehow
            // both claimed, the unique constraint blocks a duplicate row.
            idempotencyKey: `autoack-${thread.id}`,
          },
        });
        await this.outboundQueue.add('send', { messageId: ack.id }, { jobId: ack.id });
        this.log.log(`auto-ack queued for thread ${thread.id} (agent ${agent.firstName})`);
      }
    }
  }

  /**
   * Missed-call auto-reply. When an inbound WhatsApp call goes unanswered we
   * invite the caller (in-thread) to share a preferred time; their reply flows
   * into the normal AI bot pipeline, which books the callback/appointment.
   * Sent as a SYSTEM message (no sentByEmployeeId) so it does NOT disable the
   * bot — otherwise the bot couldn't pick up the caller's reply.
   *
   * Guard rails:
   *  - Free-form text needs an OPEN 24h customer-service window. A call does
   *    NOT open that window (only an inbound message does), so a contact who
   *    only ever called is skipped here — reaching them needs an approved
   *    template (tracked as a follow-up enhancement).
   *  - De-duped to at most one invite per thread per hour so a burst of missed
   *    calls doesn't spam the customer. The per-call idempotency key is a
   *    second layer against Meta webhook retries.
   */
  private async maybeSendMissedCallInvite(args: {
    threadId: string;
    channelId: string;
    leadId: string | null;
    clientId: string | null;
    waCallId: string;
  }): Promise<void> {
    const now = new Date();
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: args.threadId },
      select: { id: true, windowExpiresAt: true },
    });
    if (!thread) return;

    // No open 24h window ⇒ we can't free-form message; skip (template TODO).
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      this.log.debug(`missed-call invite skipped for thread ${args.threadId} (window closed)`);
      return;
    }

    // At most one invite per thread per hour.
    const recent = await this.prisma.whatsAppMessage.findFirst({
      where: {
        threadId: args.threadId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
        payload: { path: ['missedCallInvite'], equals: true },
      },
      select: { id: true },
    });
    if (recent) {
      this.log.debug(`missed-call invite skipped for thread ${args.threadId} (sent recently)`);
      return;
    }

    const body =
      'Hi 👋 Sorry we missed your call just now! If you’d like, simply reply here ' +
      'with a day and time that suits you and we’ll arrange a callback/appointment ' +
      'for you. We’re available Monday–Saturday, 9 AM–6 PM (Pakistan time). 🙏';

    const msg = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: args.threadId,
        channelId: args.channelId,
        leadId: args.leadId,
        clientId: args.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.QUEUED,
        body,
        // System message (no sentByEmployeeId) → keeps the AI bot active so it
        // can handle the caller's reply. The flag drives the per-hour dedupe.
        payload: { missedCallInvite: true } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `missedcall-${args.waCallId}`,
      },
      select: { id: true },
    });
    await this.outboundQueue.add('send', { messageId: msg.id }, { jobId: msg.id });
    this.log.log(`missed-call invite queued for thread ${args.threadId}`);
  }

  private async ingestStatus(st: MetaStatus): Promise<void> {
    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: st.id },
      select: { id: true, threadId: true, leadId: true, clientId: true },
    });
    if (!message) {
      this.log.debug(`status for unknown wamid ${st.id} — likely race`);
      return;
    }
    const ts = new Date(Number(st.timestamp) * 1000);
    const STATUS_MAP: Record<
      MetaStatus['status'],
      { status: WhatsAppMessageStatus; field: 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt' }
    > = {
      sent: { status: WhatsAppMessageStatus.SENT, field: 'sentAt' },
      delivered: { status: WhatsAppMessageStatus.DELIVERED, field: 'deliveredAt' },
      read: { status: WhatsAppMessageStatus.READ, field: 'readAt' },
      failed: { status: WhatsAppMessageStatus.FAILED, field: 'failedAt' },
    };
    const m = STATUS_MAP[st.status];
    if (!m) return;

    const data: Prisma.WhatsAppMessageUpdateInput = { status: m.status, [m.field]: ts };
    if (st.status === 'failed' && st.errors?.[0]) {
      data.errorCode = String(st.errors[0].code);
      data.errorTitle = st.errors[0].title ?? null;
      data.errorDetails = st.errors[0] as Prisma.InputJsonValue;
    }
    if (st.pricing?.category) {
      data.pricingCategory = st.pricing.category;
    }
    await this.prisma.whatsAppMessage.update({ where: { id: message.id }, data });

    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (org) {
      await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_STATUS, {
        threadId: message.threadId,
        messageId: message.id,
        status: m.status,
      });
    }
  }
}

// ---- helpers --------------------------------------------------------------

function splitProfileName(name: string | null, phone: string): { firstName: string; lastName: string } {
  if (!name || !name.trim()) {
    // No profile name — use the phone number as the first name placeholder.
    return { firstName: 'WhatsApp', lastName: phone.replace(/[^0-9]/g, '').slice(-4) };
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

function previewOf(msg: MetaMessage): string {
  if (msg.text?.body) return msg.text.body.slice(0, 140);
  if (msg.image) return '[image]';
  if (msg.video) return '[video]';
  if (msg.audio) return '[audio]';
  if (msg.document) return `[document${msg.document.filename ? `: ${msg.document.filename}` : ''}]`;
  if (msg.sticker) return '[sticker]';
  if (msg.location) return '[location]';
  if (msg.interactive) return '[interactive]';
  if (msg.reaction) return `[reaction ${msg.reaction.emoji}]`;
  return `[${msg.type}]`;
}

function decodeIncoming(msg: MetaMessage): {
  type: WhatsAppMessageType;
  body: string | null;
  payload: Record<string, unknown> | null;
  mediaMeta: { id: string; mime_type: string } | null;
} {
  switch (msg.type) {
    case 'text':
      return { type: WhatsAppMessageType.TEXT, body: msg.text?.body ?? null, payload: null, mediaMeta: null };
    case 'image':
      return {
        type: WhatsAppMessageType.IMAGE,
        body: msg.image?.caption ?? null,
        payload: { image: msg.image },
        mediaMeta: msg.image ? { id: msg.image.id, mime_type: msg.image.mime_type } : null,
      };
    case 'video':
      return {
        type: WhatsAppMessageType.VIDEO,
        body: msg.video?.caption ?? null,
        payload: { video: msg.video },
        mediaMeta: msg.video ? { id: msg.video.id, mime_type: msg.video.mime_type } : null,
      };
    case 'audio':
      return {
        type: WhatsAppMessageType.AUDIO,
        body: null,
        payload: { audio: msg.audio },
        mediaMeta: msg.audio ? { id: msg.audio.id, mime_type: msg.audio.mime_type } : null,
      };
    case 'document':
      return {
        type: WhatsAppMessageType.DOCUMENT,
        body: msg.document?.caption ?? null,
        payload: { document: msg.document },
        mediaMeta: msg.document ? { id: msg.document.id, mime_type: msg.document.mime_type } : null,
      };
    case 'sticker':
      return {
        type: WhatsAppMessageType.STICKER,
        body: null,
        payload: { sticker: msg.sticker },
        mediaMeta: msg.sticker ? { id: msg.sticker.id, mime_type: msg.sticker.mime_type } : null,
      };
    case 'location':
      return { type: WhatsAppMessageType.LOCATION, body: null, payload: { location: msg.location }, mediaMeta: null };
    case 'interactive':
      return { type: WhatsAppMessageType.INTERACTIVE, body: null, payload: { interactive: msg.interactive }, mediaMeta: null };
    case 'reaction':
      return {
        type: WhatsAppMessageType.REACTION,
        body: msg.reaction?.emoji ?? null,
        payload: { reaction: msg.reaction },
        mediaMeta: null,
      };
    case 'contacts':
      return { type: WhatsAppMessageType.CONTACTS, body: null, payload: { contacts: msg.contacts }, mediaMeta: null };
    default:
      return {
        type: WhatsAppMessageType.UNSUPPORTED,
        body: null,
        payload: msg as unknown as Record<string, unknown>,
        mediaMeta: null,
      };
  }
}
