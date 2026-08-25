import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { createDecipheriv } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import {
  AuditAction,
  AuditCategory,
  AuditSeverity,
  ChannelPlatform,
  FollowUpPriority,
  LeadStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { generateLeadReferenceCode } from '../../../../common/reference-codes/reference-codes';
import { findLeadByNormalizedPhone } from '../../../../common/phone/lead-dedupe';
import { findClientByNormalizedPhone } from '../../../../common/phone/client-dedupe';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { ActivityTimelineService } from '../../../activity-timeline/activity-timeline.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { PushService } from '../../../push/push.service';
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
  // On 'terminate': Meta's own view of the call outcome + CONNECTED duration in
  // seconds. Meta's duration is the authoritative talk time (excludes ring),
  // so prefer it over our locally computed value when present.
  status?: string;
  duration?: number;
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
// ---- Facebook Messenger webhook payload types (subset) --------------------
// Messenger conversational events arrive on the SAME app + callback URL as
// WhatsApp / Lead Ads, but with object='page' and an entry[].messaging[] array
// (NOT entry[].changes[]). Each messaging event is one inbound message,
// postback, or referral for one Page-Scoped user id (PSID). Instagram Direct
// uses the identical shape with object='instagram' (added in a later PR).
interface MessengerReferral {
  ref?: string;
  ad_id?: string;
  source?: string; // 'ADS' | 'SHORTLINK' | 'CUSTOMER_CHAT_PLUGIN' | ...
  type?: string; // 'OPEN_THREAD'
  ads_context_data?: { ad_title?: string; post_id?: string };
}
interface MessengerAttachment {
  type: string; // 'image' | 'video' | 'audio' | 'file' | 'location' | 'fallback' | 'template'
  payload?: { url?: string; title?: string; coordinates?: { lat: number; long: number } };
}
interface MessengerMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number; // epoch MILLISECONDS (unlike WhatsApp's seconds)
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MessengerAttachment[];
    quick_reply?: { payload?: string };
    referral?: MessengerReferral;
  };
  postback?: { mid?: string; title?: string; payload?: string; referral?: MessengerReferral };
  referral?: MessengerReferral;
}
interface MessengerWebhookPayload {
  object: string; // 'page' (Messenger) | 'instagram' (IG Direct)
  entry?: Array<{ id: string; time?: number; messaging?: MessengerMessagingEvent[] }>;
}

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
    // Central audit log — a brand-new lead auto-created on first WhatsApp
    // contact bypasses HTTP, so the global AuditInterceptor never sees it.
    // Log it explicitly so inbound-created leads appear in the audit trail.
    private readonly audit: AuditLogService,
    // High-priority FCM data push so a backgrounded / locked mobile device
    // rings for the call (the open-tab socket emit above only reaches the web
    // CallDock and foregrounded apps).
    private readonly push: PushService,
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
      // object='page' carries TWO unrelated event kinds on this single webhook URL:
      //   • Lead Ads  → entry[].changes[].field='leadgen'  → forked to the leadgen queue
      //   • Messenger → entry[].messaging[]                 → conversational, handled here
      // Distinguish by the presence of a messaging[] array so Messenger chats are
      // NOT mis-routed into the lead-form processor (which would silently drop them).
      const mp = payload as unknown as MessengerWebhookPayload;
      const hasMessaging = (mp.entry ?? []).some(
        (e) => Array.isArray(e.messaging) && e.messaging.length > 0,
      );
      if (hasMessaging) {
        try {
          await this.handleMessengerPayload(mp);
        } catch (err) {
          this.log.error(`messenger ingest failed for ${webhookEventId}: ${(err as Error).message}`);
          throw err; // let BullMQ retry
        }
        await this.prisma.whatsAppWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        return;
      }
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
      // A reply to our call-permission request (the customer tapped Allow /
      // Decline) arrives as an inbound INTERACTIVE message. Record the verdict
      // + ping the rep instead of dropping a raw "[interactive]" bubble.
      if (this.isCallPermissionReply(msg)) {
        await this.handleCallPermissionReply(channel.id, msg);
        continue;
      }
      const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
      await this.ingestInboundMessage(channel.id, msg, profileName ?? null);
    }
    for (const st of value.statuses ?? []) {
      await this.ingestStatus(st);
    }
  }

  /** True when an inbound message is the user's reply to a `call_permission_request`. */
  private isCallPermissionReply(msg: MetaMessage): boolean {
    if (msg.type !== 'interactive') return false;
    const it = msg.interactive as { type?: string } | undefined;
    return it?.type === 'call_permission_reply';
  }

  /**
   * The customer answered our `call_permission_request` (tapped Allow / Decline).
   * Meta delivers it as an inbound INTERACTIVE message of type
   * `call_permission_reply`. Without this handler the CRM never learned the
   * outcome — `callPermissionStatus` only ever read PENDING (on request) or was
   * set optimistically after a successful call, so reps had no signal that a
   * customer had opted in.
   *
   * Call permission is what authorises a BUSINESS-INITIATED call independent of
   * the 24h messaging window, so granting it is exactly the green light a rep is
   * waiting for. We stamp the verdict on the thread, drop a friendly line into
   * the chat, fire the (previously-declared-but-never-emitted) CALL_PERMISSION
   * realtime event, and bell-notify the assigned rep. The full raw payload is
   * already persisted on whatsAppWebhookEvent, so nothing is lost if Meta tweaks
   * the shape.
   */
  private async handleCallPermissionReply(channelId: string, msg: MetaMessage): Promise<void> {
    // Idempotent: each webhook event processes once (processedAt), but Meta can
    // REDELIVER the same reply in a fresh event — dedupe on the unique waMessageId.
    const already = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.id },
      select: { id: true },
    });
    if (already) return;

    const it = msg.interactive as
      | {
          call_permission_reply?: {
            response?: string;
            expiration_timestamp?: number | string;
            // Permanent grant (no expiry — valid until the customer revokes).
            is_permanent?: boolean;
            // 'user_action' = tapped Allow on our request message;
            // 'automatic'  = granted via Meta's own callback prompt after a
            //                missed/ended call (callback_permission_status).
            response_source?: string;
          };
        }
      | undefined;
    const reply = it?.call_permission_reply;
    const granted = String(reply?.response ?? '').toLowerCase() === 'accept';
    const isPermanent = reply?.is_permanent === true;
    const viaCallbackPrompt = String(reply?.response_source ?? '') === 'automatic';
    const now = new Date();

    // expiration_timestamp is seconds in Meta's raw payload (some BSPs send ms).
    // Normalise; default to Meta's 7-day grant if absent on an accept. A
    // PERMANENT grant carries no expiry — null (both the web chip and mobile
    // canCall already treat a null expiry as non-expiring).
    let expiresAt: Date | null = null;
    if (granted && !isPermanent) {
      const rawTs = reply?.expiration_timestamp;
      const n = typeof rawTs === 'string' ? Number(rawTs) : rawTs;
      expiresAt =
        n && Number.isFinite(n)
          ? new Date(n > 1e12 ? n : n * 1000)
          : new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    }

    // We only send permission requests on existing threads, so one must exist.
    const thread = await this.prisma.whatsAppThread.findFirst({
      where: { channelId, waContactId: msg.from },
      select: {
        id: true,
        leadId: true,
        clientId: true,
        lead: { select: { firstName: true, phone: true, assignedEmployeeId: true } },
      },
    });
    if (!thread) {
      this.log.warn(
        `call-permission reply with no thread (channel ${channelId}, contact ${msg.from})`,
      );
      return;
    }

    await this.prisma.whatsAppThread.update({
      where: { id: thread.id },
      data: {
        callPermissionStatus: granted ? 'GRANTED' : 'REJECTED',
        callPermissionUpdatedAt: now,
        callPermissionExpiresAt: expiresAt, // null on decline — clears any prior grant
        lastMessageAt: now,
        lastMessagePreview: granted ? '✅ Allowed WhatsApp calls' : '✋ Declined WhatsApp calls',
      },
    });

    const expiryNote = isPermanent
      ? ' (permanent)'
      : expiresAt
        ? ` (until ${expiresAt.toISOString().slice(0, 10)})`
        : '';
    const sourceNote = viaCallbackPrompt ? ' — via Meta’s callback prompt after their call' : '';
    await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        waMessageId: msg.id,
        direction: WhatsAppMessageDirection.INBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.RECEIVED,
        body: granted
          ? `🔔 Customer ALLOWED WhatsApp calls${expiryNote}${sourceNote}. You can call them now.`
          : '🔔 Customer DECLINED WhatsApp calls.',
        // Keep the raw grant facts queryable (permanent vs temporary, and
        // whether Meta's automatic callback prompt — not our request — earned it).
        payload: {
          callPermissionReply: true,
          isPermanent,
          responseSource: reply?.response_source ?? null,
        } as unknown as Prisma.InputJsonValue,
        createdAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : now,
      },
    });

    // Realtime hint for any open inbox / CallDock (the event was declared in
    // the WS contract but, until now, never actually emitted).
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (org) {
      await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.CALL_PERMISSION, {
        threadId: thread.id,
        leadId: thread.leadId,
        clientId: thread.clientId,
        status: granted ? 'GRANTED' : 'REJECTED',
        // null = permanent grant (clients already render a missing expiry as
        // non-expiring "Calls allowed").
        expiresAt: expiresAt?.toISOString() ?? null,
        isPermanent,
      });
    }

    // Bell-notify the assigned rep — this is the green light they were missing.
    const assignedEmployeeId = thread.lead?.assignedEmployeeId ?? null;
    if (assignedEmployeeId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: assignedEmployeeId },
        select: { user: { select: { id: true } } },
      });
      const userId = emp?.user?.id;
      if (userId) {
        const who = (thread.lead?.firstName ?? thread.lead?.phone ?? 'Customer').trim();
        await this.notifications.create({
          userId,
          type: 'WHATSAPP_CALL',
          title: granted ? `📞 ${who} allowed WhatsApp calls` : `${who} declined WhatsApp calls`,
          body: granted ? 'You can place a WhatsApp call now.' : 'Call permission was not granted.',
          link: thread.leadId ? `/sales/leads/${thread.leadId}` : '/sales/inbox',
        });
      }
    }

    this.log.log(
      `call-permission reply for thread ${thread.id}: ${granted ? 'GRANTED' : 'REJECTED'}${expiryNote}`,
    );
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
          answeredAt: true,
          assignedEmployeeId: true,
          answeredByEmployeeId: true,
          answeredByUserId: true,
          direction: true,
          threadId: true,
          channelId: true,
          leadId: true,
          clientId: true,
        },
      });
      if (!existing) return;
      // Idempotency: Meta delivers webhooks at-least-once, and duplicate
      // 'terminate' events are common (more so when media took a while to
      // negotiate). A duplicate terminate on an ALREADY-CLOSED call must not be
      // reprocessed — otherwise the second run reads status=ENDED (not
      // ANSWERED), recomputes answered=false, flips a genuinely-answered call to
      // MISSED, and fires a bogus "we missed your call" invite for a call that
      // actually connected. If the row is already terminal, the first terminate
      // handled everything (teardown + status + any invite); stop here.
      if (existing.status === 'ENDED' || existing.status === 'MISSED') return;
      // A call a rep actually answered is never "missed" — key off the answerer
      // stamps as well as status, so a status race can't mislabel a connected
      // call. answeredByUserId covers the employee-less admin console.
      const answered =
        existing.status === 'ANSWERED' ||
        existing.answeredByEmployeeId != null ||
        existing.answeredByUserId != null;
      // Talk time: prefer Meta's own connected-call duration from the terminate
      // payload (authoritative, excludes ring); else compute from answeredAt
      // (pick-up). startedAt is the RING start on inbound rows, so it's only the
      // legacy fallback — durations computed from it include ring time.
      const metaDuration =
        typeof call.duration === 'number' && Number.isFinite(call.duration) && call.duration > 0
          ? Math.round(call.duration)
          : null;
      const talkAnchor = existing.answeredAt ?? existing.startedAt;
      const computedSecs =
        answered && talkAnchor
          ? Math.max(0, Math.round((now.getTime() - talkAnchor.getTime()) / 1000))
          : null;
      const talkSecs = answered ? (metaDuration ?? computedSecs) : null;
      await this.prisma.whatsAppCall.update({
        where: { id: existing.id },
        data: {
          status: answered ? 'ENDED' : 'MISSED',
          event: 'terminate',
          endedAt: now,
          durationSeconds: talkSecs ?? undefined,
        },
      });
      // Sales-activity record: drop a "Call ended — Talk time…" SYSTEM line into
      // the thread for a connected call (the customer-hung-up path). Idempotent
      // per call via the same `call-ended-${id}` key the CRM-side hang-up uses, so
      // whichever side ends the call, exactly one line is written.
      if (answered && existing.threadId && talkSecs != null) {
        const secs = talkSecs;
        if (secs > 0) {
          const talk = `${String(Math.floor(secs / 60)).padStart(2, '0')} min ${String(secs % 60).padStart(2, '0')} sec`;
          try {
            const line = await this.prisma.whatsAppMessage.create({
              data: {
                threadId: existing.threadId,
                channelId: existing.channelId,
                direction: existing.direction === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND',
                type: 'SYSTEM',
                body: `Call ended — Talk time: ${talk}`,
                status: 'SENT',
                sentAt: now,
                idempotencyKey: `call-ended-${existing.id}`,
              },
              select: { id: true },
            });
            const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
            if (org) {
              await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_NEW, {
                threadId: existing.threadId,
                leadId: existing.leadId,
                clientId: existing.clientId,
                messageId: line.id,
                direction: existing.direction === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND',
              });
            }
          } catch (e) {
            if ((e as { code?: string }).code !== 'P2002') {
              this.log.warn(`talk-time message failed for call ${existing.id}: ${(e as Error).message}`);
            }
          }
        }
      }
      if (existing.assignedEmployeeId) {
        await this.publisher.publishToEmployee(
          existing.assignedEmployeeId,
          WHATSAPP_WS_EVENTS.CALL_ENDED,
          { callId: existing.id },
        );
        // Dismiss any native incoming-call ring on the rep's backgrounded /
        // locked mobile device (the socket above only reaches foreground apps).
        const emp = await this.prisma.employee.findUnique({
          where: { id: existing.assignedEmployeeId },
          select: { user: { select: { id: true } } },
        });
        if (emp?.user?.id) {
          await this.push.sendCallCancel(emp.user.id, existing.id);
        }
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
          // For OUTBOUND, this webhook IS the customer picking up — stamp both
          // (talk time anchors on answeredAt everywhere).
          answeredAt: new Date(),
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
    const { leadId, clientId, blocked, createdLead } = await this.withPhoneLock(phone, async () => {
      // Exact-string client lookup FIRST (index-fast) then a variant walk on
      // miss. Before the walk was added, a client stored as `03xx…` and an
      // inbound call arriving as `+92xx…` looked like unrelated numbers, so
      // the code fell through and made a fresh Lead → duplicate. Now both
      // formats resolve to the same client. `blockedAt` is folded into the
      // walk-branch fetch too so a blocked contact's call still short-
      // circuits before any thread/call/push work happens.
      let existingClient: { id: string; blockedAt: Date | null } | null =
        await this.prisma.client.findFirst({
          where: { phone, deletedAt: null },
          select: { id: true, blockedAt: true },
        });
      if (!existingClient) {
        const variantHit = await findClientByNormalizedPhone(this.prisma, phone);
        if (variantHit) {
          existingClient = await this.prisma.client.findUnique({
            where: { id: variantHit.id },
            select: { id: true, blockedAt: true },
          });
        }
      }
      if (existingClient) {
        return {
          leadId: null as string | null,
          clientId: existingClient.id as string | null,
          blocked: !!existingClient.blockedAt,
          createdLead: false,
        };
      }
      // Exact-match first (index-fast for the common case where the lead is
      // already stored as +E.164), then fall back to a NORMALISED (last-10)
      // match so a lead stored in another format (local "03xx…") still matches
      // instead of spawning a duplicate. The seq-scan only runs on exact-miss.
      const existingLead =
        (await this.prisma.lead.findFirst({
          where: { phone, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, blockedAt: true },
        })) ?? (await findLeadByNormalizedPhone(this.prisma, phone));
      if (existingLead) {
        return {
          leadId: existingLead.id as string | null,
          clientId: null as string | null,
          blocked: !!existingLead.blockedAt,
          createdLead: false,
        };
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
      // A freshly created lead is never blocked.
      return {
        leadId: newLead.id as string | null,
        clientId: null as string | null,
        blocked: false,
        createdLead: true,
      };
    });

    // Block enforcement: a blocked contact's call is silently dropped — NO ring,
    // NO notification, NO call row, NO thread upsert. Logged once for audit.
    if (blocked) {
      this.log.log(`inbound call dropped — contact blocked (phone ${phone})`);
      return;
    }

    // Central audit: a brand-new lead auto-created from a first inbound WhatsApp
    // CALL (same identity rule as messages). Logged once on creation only.
    if (createdLead && leadId) {
      void this.audit
        .log({
          action: AuditAction.LEAD_CREATED,
          entityType: 'Lead',
          entityId: leadId,
          category: AuditCategory.WEBHOOK,
          severity: AuditSeverity.HIGH,
          metadata: {
            source: 'whatsapp_inbound_call',
            phoneLast4: phone.replace(/[^0-9]/g, '').slice(-4),
          },
        })
        .catch(() => undefined);
    }

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

    // Route to the assigned rep. ORDER MATTERS: every millisecond here is dead
    // air the CALLER spends listening to ringing, so we RING FIRST and do all
    // bookkeeping afterwards. (This block used to run a callback-task write and
    // a bell-notification write BEFORE the ring — ~1-2s of avoidable latency on
    // a cross-region DB, on top of the ~8 round-trips already above.)
    try {
      // ONE query for everything the ring needs: the lead, its assigned rep, and
      // that rep's userId (previously a second employee lookup).
      const t = await this.prisma.whatsAppThread.findUnique({
        where: { id: thread.id },
        select: {
          lead: {
            select: {
              id: true, firstName: true, lastName: true, phone: true, assignedEmployeeId: true,
              assignedEmployee: { select: { user: { select: { id: true } } } },
            },
          },
        },
      });
      const lead = t?.lead ?? null;
      const assignedEmployeeId = lead?.assignedEmployeeId ?? null;
      if (assignedEmployeeId) {
        const userId = lead?.assignedEmployee?.user?.id ?? null;
        const who = `${lead?.firstName ?? ''} ${lead?.lastName ?? ''}`.trim() || lead?.phone || phone;
        const ring = {
          callId: callRow.id,
          from: phone,
          leadId: lead?.id ?? null,
          leadName: who,
          threadId: thread.id,
        };

        // ── RING NOW ────────────────────────────────────────────────────────
        // Browser (CallDock, per-employee channel so only the assigned rep's
        // tabs ring) and the mobile app (high-priority data push → CallKit even
        // when backgrounded/locked) go out TOGETHER, not one after the other.
        await Promise.all([
          this.publisher.publishToEmployee(
            assignedEmployeeId,
            WHATSAPP_WS_EVENTS.CALL_INCOMING,
            ring,
          ),
          userId ? this.push.sendCallInvite(userId, ring) : Promise.resolve(),
        ]);

        // ── Bookkeeping AFTER the phone is already ringing ───────────────────
        // NOTE: the "Call back …" follow-up is deliberately NOT created here.
        // It used to fire on EVERY inbound call — including ones answered
        // seconds later — producing ~38% phantom tasks that buried the genuine
        // misses in the rep's callback list. It is now created only when the
        // call is actually MISSED (see maybeSendMissedCallInvite's caller).
        await this.prisma.whatsAppCall
          .updateMany({ where: { waCallId: call.id }, data: { assignedEmployeeId } })
          .catch(() => undefined);
        if (userId) {
          await this.notifications.create({
            userId,
            type: 'WHATSAPP_CALL',
            title: `📞 WhatsApp call from ${who}`,
            body: phone,
            link: lead?.id ? `/sales/leads/${lead.id}` : '/sales/inbox',
          });
        }
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
    const { leadId, clientId, createdLead, blocked } = await this.withPhoneLock(phone, async () => {
      // Same variant walk as the call path. Client.phone is UNIQUE so exact
      // match is index-fast; on miss we walk digit-string variants so a
      // client stored as `03xx…` still matches an inbound `+92xx…`. Without
      // this, the message path would spawn a fresh lead for a person who is
      // already a paying customer — one of the confirmed sources of the
      // 2026-08-11 audit's crossover duplicates.
      let existingClient: { id: string; blockedAt: Date | null } | null =
        await this.prisma.client.findFirst({
          where: { phone, deletedAt: null },
          select: { id: true, blockedAt: true },
        });
      if (!existingClient) {
        const variantHit = await findClientByNormalizedPhone(this.prisma, phone);
        if (variantHit) {
          existingClient = await this.prisma.client.findUnique({
            where: { id: variantHit.id },
            select: { id: true, blockedAt: true },
          });
        }
      }
      let leadId: string | null = null;
      const clientId: string | null = existingClient?.id ?? null;
      let createdLead = false;
      // A blocked contact (lead OR client) drops the inbound. A freshly created
      // lead (below) is never blocked, so we only read block state off existing rows.
      let blocked = !!existingClient?.blockedAt;

      if (!clientId) {
        // Exact-match first (index-fast for the common case where the lead is
        // already stored as +E.164), then fall back to a NORMALISED (last-10)
        // match so a lead stored in another format (local "03xx…") still matches
        // instead of spawning a duplicate. The seq-scan only runs on exact-miss.
        const existingLead =
          (await this.prisma.lead.findFirst({
            where: { phone, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, blockedAt: true },
          })) ?? (await findLeadByNormalizedPhone(this.prisma, phone));
        if (existingLead) {
          leadId = existingLead.id;
          blocked = !!existingLead.blockedAt;
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
      return { leadId, clientId, createdLead, blocked };
    });

    // Block enforcement: if the resolved contact is blocked, drop the inbound
    // entirely — NO thread upsert, NO message row, NO AI enqueue, no realtime
    // fanout. Logged once for audit. (A freshly created lead is never blocked.)
    if (blocked) {
      this.log.log(`inbound message dropped — contact blocked (phone ${phone})`);
      return;
    }

    // Central audit: a brand-new lead was just auto-created from first inbound
    // WhatsApp contact (round-robin / generateLeadReferenceCode path). Logged
    // ONCE on creation only — never when an existing lead/client/thread matched.
    // Fire-and-forget: the audit write must never break inbound ingest.
    if (createdLead && leadId) {
      void this.audit
        .log({
          action: AuditAction.LEAD_CREATED,
          entityType: 'Lead',
          entityId: leadId,
          category: AuditCategory.WEBHOOK,
          severity: AuditSeverity.HIGH,
          metadata: {
            source: 'whatsapp_inbound',
            // Last-4 only — never store the full phone (PII).
            phoneLast4: phone.replace(/[^0-9]/g, '').slice(-4),
          },
        })
        .catch(() => undefined);
    }

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
        // A customer message is real activity → bump the inbox sort key.
        lastHumanActivityAt: now,
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
        // A customer message is real activity → bump the inbox sort key.
        lastHumanActivityAt: now,
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

    // Durable ad attribution ON THE LEAD. The CTWA referral is stored on the
    // thread above, but the thread↔lead link is onDelete:SetNull — when the lead
    // converts to a client the thread detaches and that attribution orphans. So
    // also stamp the ad onto the lead itself, where it survives conversion.
    // First-touch wins: only if the lead has no ad yet, so the ad that GENERATED
    // the lead is kept even if the contact later clicks another ad.
    if (leadId && msg.referral?.source_id) {
      const existing = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { metaAdId: true },
      });
      if (existing && !existing.metaAdId) {
        const adId = msg.referral.source_id;
        // Best-effort enrichment from the spend cache — the ad name + campaign
        // may not be synced yet; the ad id is the durable datum and the rest
        // always re-derives from it (spend cache / hierarchy sync).
        const spend = await this.prisma.adSpendDaily.findFirst({
          where: { adId },
          orderBy: { date: 'desc' },
          select: { adName: true, campaignId: true, campaignName: true },
        });
        await this.prisma.lead.update({
          where: { id: leadId },
          data: {
            metaSource: 'ctwa',
            metaAdId: adId,
            metaAdName: spend?.adName ?? null,
            metaCampaignId: spend?.campaignId ?? null,
            metaCampaignName: spend?.campaignName ?? null,
            ctwaClid: msg.referral.ctwa_clid ?? null,
          },
        });
      }
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
            // Mobile: tap opens this chat; tag collapses per-thread so the
            // newest message replaces the previous notification.
            pushData: { threadId: thread.id },
            pushTag: thread.id,
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
   *  - An OPEN 24h window ⇒ free-form text (below). A CLOSED window (a call
   *    does NOT open the window — only an inbound message does) ⇒ the approved
   *    `missed_call_callback` UTILITY template instead, so callers who only
   *    ever called (43% of misses previously got NOTHING) are still invited.
   *    If the template isn't approved/synced yet, the closed-window case
   *    degrades to the old skip.
   *  - De-duped to at most one invite per thread per hour so a burst of missed
   *    calls doesn't spam the customer. The per-call idempotency key is a
   *    second layer against Meta webhook retries.
   */
  /**
   * Create the owning rep's "call them back" task for a genuinely missed call.
   * Deliberately NOT called from the ring path (see handleIncomingCall): a task
   * must only exist for a call nobody answered. Skips when the lead already has
   * an OPEN callback task, so repeat missed calls don't stack duplicates.
   */
  private async createMissedCallTask(
    lead: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      assignedEmployeeId: string | null;
      assignedEmployee: { user: { id: string } | null } | null;
    } | null,
    threadId: string,
  ): Promise<void> {
    const employeeId = lead?.assignedEmployeeId;
    const userId = lead?.assignedEmployee?.user?.id;
    if (!lead?.id || !employeeId || !userId) return;

    const existing = await this.prisma.followUp.findFirst({
      where: { leadId: lead.id, status: 'OPEN', title: { startsWith: 'Call back' } },
      select: { id: true },
    });
    if (existing) {
      this.log.debug(`missed-call task skipped for lead ${lead.id} (one already open)`);
      return;
    }

    const who = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || lead.phone || 'this contact';
    await this.prisma.followUp.create({
      data: {
        leadId: lead.id,
        assignedEmployeeId: employeeId,
        createdByUserId: userId,
        title: `Call back ${who}`,
        description: `Missed WhatsApp call from ${lead.phone ?? 'this contact'} — call them back.`,
        contactMethod: 'WHATSAPP',
        dueAt: new Date(),
        priority: FollowUpPriority.HIGH,
      },
    });
    this.log.log(`missed-call callback task created for lead ${lead.id} (thread ${threadId})`);
  }

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
      select: {
        id: true,
        windowExpiresAt: true,
        lead: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, assignedEmployeeId: true,
            assignedEmployee: { select: { user: { select: { id: true } } } },
          },
        },
        client: { select: { firstName: true } },
      },
    });
    if (!thread) return;

    // At most one invite per thread per hour (both free-form + template paths
    // stamp payload.missedCallInvite, so the dedupe covers either).
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

    // The "call them back" task belongs HERE — this runs only when a call was
    // genuinely MISSED. It used to be created on every inbound call at ring
    // time, so ~38% of tasks were phantoms for calls the rep actually answered,
    // burying the real misses in the callback list (2222 tasks vs 1612 real
    // misses, 1348 left open). One OPEN task per lead is enough — a second
    // missed call from the same lead shouldn't stack another row.
    void this.createMissedCallTask(thread.lead, args.threadId).catch(() => undefined);

    const windowOpen =
      !!thread.windowExpiresAt && thread.windowExpiresAt.getTime() > now.getTime();

    // Closed window ⇒ template path. Meta only accepts approved templates
    // outside the 24h window.
    if (!windowOpen) {
      await this.sendMissedCallTemplate(args, thread.lead?.firstName ?? thread.client?.firstName);
      return;
    }

    const body =
      'Hi 👋 Sorry we missed your call just now! If you’d like, simply reply here ' +
      'with a day and time that suits you and we’ll arrange a callback/appointment ' +
      'for you. We’re available Monday–Saturday, 9 AM–6 PM (Pakistan time). 🙏';

    try {
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
    } catch (e) {
      // P2002 = a concurrent duplicate-terminate redelivery already created this
      // call's invite (idempotencyKey unique) — fine, exactly one send. Same
      // swallow as the template path, so no ERROR-level log noise.
      if ((e as { code?: string }).code === 'P2002') return;
      throw e;
    }
  }

  /**
   * Closed-window missed-call invite: send the approved `missed_call_callback`
   * UTILITY template (a template is the only thing Meta accepts outside the 24h
   * window; a call does not open one). Degrades to a debug-skip when the
   * template isn't approved/synced on the channel yet, so this is safe to ship
   * before the template clears Meta review. Same payload.missedCallInvite flag
   * as the free-form path so the caller's per-hour dedupe covers both.
   */
  private async sendMissedCallTemplate(
    args: {
      threadId: string;
      channelId: string;
      leadId: string | null;
      clientId: string | null;
      waCallId: string;
    },
    rawFirstName: string | null | undefined,
  ): Promise<void> {
    const tpl = await this.prisma.whatsAppTemplate.findFirst({
      where: { channelId: args.channelId, name: 'missed_call_callback', status: 'APPROVED' },
      select: { name: true, language: true, components: true },
    });
    if (!tpl) {
      this.log.debug(
        `missed-call invite skipped for thread ${args.threadId} (window closed, missed_call_callback template not approved/synced)`,
      );
      return;
    }

    // Greeting name: drop placeholder junk so the template never greets a phone
    // number or a system placeholder. Falls back to a neutral "there". Note
    // "WhatsApp": caller-only leads (this template's PRIMARY audience) are
    // auto-named "WhatsApp <digits>", so without this filter the customer would
    // literally receive "Hi WhatsApp, sorry we just missed your call…".
    const v = (rawFirstName ?? '').trim();
    const name =
      v.length >= 2 &&
      !/^[+\d]/.test(v) &&
      !/^customer\b/i.test(v) &&
      !/^whatsapp\b/i.test(v)
        ? v
        : 'there';

    // Rendered body for the chat panel (what the customer will see).
    const bodyComponent = (Array.isArray(tpl.components) ? tpl.components : []).find(
      (c): c is { type: string; text?: string } =>
        !!c && typeof c === 'object' && String((c as { type?: unknown }).type).toUpperCase() === 'BODY',
    );
    const rendered =
      typeof bodyComponent?.text === 'string'
        ? bodyComponent.text.replace(/\{\{1\}\}/g, name)
        : null;

    try {
      const msg = await this.prisma.whatsAppMessage.create({
        data: {
          threadId: args.threadId,
          channelId: args.channelId,
          leadId: args.leadId,
          clientId: args.clientId,
          direction: WhatsAppMessageDirection.OUTBOUND,
          type: WhatsAppMessageType.TEMPLATE,
          status: WhatsAppMessageStatus.QUEUED,
          templateName: tpl.name,
          templateLanguage: tpl.language,
          body: rendered,
          // Bot-attributed (no sentByEmployeeId) → the AI bot stays active for
          // the caller's reply. missedCallInvite drives the per-hour dedupe.
          payload: {
            components: [
              { type: 'body', parameters: [{ type: 'text', text: name }] },
            ],
            missedCallInvite: true,
            source: 'missed_call_template',
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `missedcall-${args.waCallId}`,
        },
        select: { id: true },
      });
      await this.outboundQueue.add('send', { messageId: msg.id }, { jobId: msg.id });
      this.log.log(`missed-call TEMPLATE invite queued for thread ${args.threadId}`);
    } catch (e) {
      // P2002 = this call already produced an invite (webhook redelivery) — fine.
      if ((e as { code?: string }).code === 'P2002') return;
      this.log.warn(
        `missed-call template invite failed for thread ${args.threadId}: ${(e as Error).message}`,
      );
    }
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

  // ─── Facebook Messenger ingestion ───────────────────────────────────────────
  // Mirrors the WhatsApp inbound path (resolve/create lead → upsert thread →
  // write message → assign → realtime fanout) but keyed off the Page-Scoped user
  // id (PSID) instead of a phone number. A Messenger lead has NO phone, so it
  // gets a `messenger-<psid>` placeholder (letter-containing, so the phone dedupe
  // never matches it) and identity is the (channel, PSID) pair.
  //
  // DORMANT until (a) a MESSENGER channel row exists and (b) the Page's webhook is
  // subscribed. Until then no page carries a channel, so this returns with no
  // side effects — safe to ship ahead of go-live.
  private readonly psidLocks = new Map<string, Promise<void>>();

  private async handleMessengerPayload(payload: MessengerWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      const pageId = entry.id;
      const channel = await this.prisma.whatsAppChannel.findFirst({
        where: { pageId, platform: ChannelPlatform.MESSENGER, status: 'ACTIVE' },
        select: { id: true, accessTokenEnc: true },
      });
      if (!channel) {
        this.log.warn(`no MESSENGER channel for page ${pageId} — dropping messaging event`);
        continue;
      }
      for (const ev of entry.messaging ?? []) {
        try {
          await this.ingestMessengerEvent(channel, ev);
        } catch (err) {
          this.log.error(`messenger event failed (page ${pageId}): ${(err as Error).message}`);
        }
      }
    }
  }

  private async ingestMessengerEvent(
    channel: { id: string; accessTokenEnc: string },
    ev: MessengerMessagingEvent,
  ): Promise<void> {
    const psid = ev.sender?.id;
    if (!psid) return;
    if (ev.message?.is_echo) return; // our own outbound, echoed back

    const referral = ev.message?.referral ?? ev.postback?.referral ?? ev.referral ?? null;
    const hasContent = !!(ev.message?.text || ev.message?.attachments?.length || ev.postback);
    if (!hasContent && !referral) return; // delivery/read receipt — nothing to do

    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);
    const mid = ev.message?.mid ?? ev.postback?.mid ?? null;

    // Normalise the Messenger referral to the CTWA shape so `teamForReferral`
    // (which keys off `source_id`) routes a Messenger ad through the SAME
    // AdRoutingRule engine as a WhatsApp ad.
    const adReferral: Prisma.InputJsonValue | undefined = referral
      ? {
          source_id: referral.ad_id ?? null,
          source_type: 'ad',
          source: referral.source ?? 'ADS',
          ref: referral.ref ?? null,
          headline: referral.ads_context_data?.ad_title ?? null,
          platform: 'MESSENGER',
        }
      : undefined;
    const adReferralUpdate = adReferral ? { adReferral, adReferralAt: now } : {};

    // Resolve/create the lead under a per-PSID lock so two events from the same
    // brand-new contact can't both create a lead (the orphan-lead race).
    const { leadId, clientId, createdLead } = await this.withPsidLock(psid, async () => {
      const existing = await this.prisma.whatsAppThread.findUnique({
        where: { channelId_waContactId: { channelId: channel.id, waContactId: psid } },
        select: { leadId: true, clientId: true },
      });
      if (existing && (existing.leadId || existing.clientId)) {
        return { leadId: existing.leadId, clientId: existing.clientId, createdLead: false };
      }
      const branch = await this.prisma.branch.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const profile = await this.fetchMessengerProfile(channel, psid);
      const { firstName, lastName } = splitMessengerName(profile, psid);
      const referenceCode = await generateLeadReferenceCode(this.prisma);
      const newLead = await this.prisma.lead.create({
        data: {
          referenceCode,
          firstName,
          lastName,
          phone: `messenger-${psid}`,
          sourceChannel: 'messenger',
          status: LeadStatus.NEW,
          ...(branch ? { branchId: branch.id } : {}),
        },
        select: { id: true },
      });
      return { leadId: newLead.id as string, clientId: null as string | null, createdLead: true };
    });

    if (createdLead && leadId) {
      void this.audit
        .log({
          action: AuditAction.LEAD_CREATED,
          entityType: 'Lead',
          entityId: leadId,
          category: AuditCategory.WEBHOOK,
          severity: AuditSeverity.HIGH,
          metadata: { source: 'messenger_inbound', psidLast4: psid.slice(-4) },
        })
        .catch(() => undefined);
    }

    const thread = await this.prisma.whatsAppThread.upsert({
      where: { channelId_waContactId: { channelId: channel.id, waContactId: psid } },
      create: {
        channelId: channel.id,
        platform: ChannelPlatform.MESSENGER,
        leadId,
        clientId,
        waContactId: psid,
        windowExpiresAt,
        firstInboundAt: now,
        lastMessageAt: now,
        lastMessagePreview: decodeMessengerEvent(ev).preview,
        unreadCount: 1,
        lastCustomerMessageAt: now,
        lastHumanActivityAt: now,
        awaitingReply: true,
        ...adReferralUpdate,
      },
      update: {
        ...(leadId && { leadId }),
        ...(clientId && { clientId }),
        windowExpiresAt,
        lastMessageAt: now,
        lastMessagePreview: decodeMessengerEvent(ev).preview,
        unreadCount: { increment: 1 },
        lastCustomerMessageAt: now,
        lastHumanActivityAt: now,
        awaitingReply: true,
        status: 'OPEN',
        ...adReferralUpdate,
      },
      select: { id: true },
    });

    // First-touch ad attribution on the lead (survives lead→client conversion).
    if (leadId && referral?.ad_id) {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { metaAdId: true } });
      if (lead && !lead.metaAdId) {
        const spend = await this.prisma.adSpendDaily.findFirst({
          where: { adId: referral.ad_id },
          orderBy: { date: 'desc' },
          select: { adName: true, campaignId: true, campaignName: true },
        });
        await this.prisma.lead.update({
          where: { id: leadId },
          data: {
            metaSource: 'messenger-ad',
            metaAdId: referral.ad_id,
            metaAdName: spend?.adName ?? null,
            metaCampaignId: spend?.campaignId ?? null,
            metaCampaignName: spend?.campaignName ?? null,
          },
        });
      }
    }

    const decoded = decodeMessengerEvent(ev);

    // Write the message row (skip for a pure referral/receipt with no mid).
    if (decoded.hasMessage && mid) {
      const dupe = await this.prisma.whatsAppMessage.findUnique({ where: { waMessageId: mid }, select: { id: true } });
      if (!dupe) {
        const message = await this.prisma.whatsAppMessage.create({
          data: {
            threadId: thread.id,
            channelId: channel.id,
            leadId,
            clientId,
            waMessageId: mid,
            direction: WhatsAppMessageDirection.INBOUND,
            type: decoded.type,
            status: WhatsAppMessageStatus.RECEIVED,
            body: decoded.body,
            payload: decoded.payload as Prisma.InputJsonValue,
            // Messenger inbound media is a signed, EXPIRING URL. Stored as-is for
            // now; a URL-based rehost (mirroring MediaDownloadProcessor) lands with
            // the outbound/media PR so old media doesn't 404.
            mediaUrl: decoded.mediaUrl,
            ...(adReferral ? { adReferral } : {}),
            createdAt: ev.timestamp ? new Date(ev.timestamp) : now,
          },
          select: { id: true },
        });

        await this.timeline.record({
          entityType: clientId ? 'Client' : 'Lead',
          entityId: (clientId ?? leadId)!,
          leadId: leadId ?? undefined,
          clientId: clientId ?? undefined,
          eventType: createdLead ? 'WHATSAPP_LEAD_CREATED' : 'WHATSAPP_MESSAGE_RECEIVED',
          description: createdLead
            ? `New Messenger lead (${psid})`
            : `Messenger message: ${(decoded.body ?? '[' + decoded.type.toLowerCase() + ']').slice(0, 80)}`,
          metadata: { channelId: channel.id, threadId: thread.id, messageId: message.id, type: decoded.type, platform: 'MESSENGER' },
        });

        const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (org) {
          await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_NEW, {
            threadId: thread.id,
            leadId,
            clientId,
            messageId: message.id,
            direction: 'INBOUND',
          });
        }
      }
    }

    // Reuse the shared round-robin engine. Branch-scoped Messenger defaulting
    // (→ Islamabad) is layered on in the distribution PR; here it uses the same
    // path as WhatsApp (ad-rule team if the referral matches, else whole pool).
    try {
      await this.assignment.ensureAssigned(thread.id);
    } catch (err) {
      this.log.error(`messenger assignment failed for thread ${thread.id}: ${(err as Error).message}`);
    }
  }

  /** Per-PSID in-process serialization (mirrors withPhoneLock for Messenger). */
  private async withPsidLock<T>(psid: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.psidLocks.get(psid) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.psidLocks.set(psid, prev.then(() => next));
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.psidLocks.get(psid) === next) this.psidLocks.delete(psid);
    }
  }

  /** Best-effort Facebook profile fetch for a PSID. Never throws. */
  private async fetchMessengerProfile(
    channel: { accessTokenEnc: string },
    psid: string,
  ): Promise<{ first_name?: string; last_name?: string } | null> {
    try {
      const token = this.resolveMessengerToken(channel);
      if (!token) return null;
      const ver = process.env.META_GRAPH_API_VERSION || 'v21.0';
      const res = await fetch(
        `https://graph.facebook.com/${ver}/${encodeURIComponent(psid)}?fields=first_name,last_name&access_token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as { first_name?: string; last_name?: string };
    } catch {
      return null;
    }
  }

  /** Resolve the Page access token: env override, else decrypt the channel token. */
  private resolveMessengerToken(channel: { accessTokenEnc: string }): string | null {
    const env = process.env.META_PAGE_ACCESS_TOKEN;
    if (env && env.trim()) return env.trim();
    const key = process.env.WHATSAPP_ENCRYPTION_KEY;
    if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) return null;
    try {
      const [ivB64, dataB64, tagB64] = channel.accessTokenEnc.split(':');
      if (!ivB64 || !dataB64 || !tagB64) return null;
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
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

// ---- Messenger helpers ----------------------------------------------------

function splitMessengerName(
  profile: { first_name?: string; last_name?: string } | null,
  psid: string,
): { firstName: string; lastName: string } {
  const first = profile?.first_name?.trim();
  const last = profile?.last_name?.trim();
  if (first || last) return { firstName: first || 'Messenger', lastName: last || '' };
  // No profile (private/unavailable) — a stable placeholder the rep can rename.
  return { firstName: 'Messenger', lastName: psid.slice(-4) };
}

function decodeMessengerEvent(ev: MessengerMessagingEvent): {
  hasMessage: boolean;
  type: WhatsAppMessageType;
  body: string | null;
  preview: string;
  payload: Record<string, unknown> | null;
  mediaUrl: string | null;
} {
  const m = ev.message;
  if (m?.text) {
    return { hasMessage: true, type: WhatsAppMessageType.TEXT, body: m.text, preview: m.text.slice(0, 140), payload: null, mediaUrl: null };
  }
  const att = m?.attachments?.[0];
  if (att) {
    const ATT_MAP: Record<string, WhatsAppMessageType> = {
      image: WhatsAppMessageType.IMAGE,
      video: WhatsAppMessageType.VIDEO,
      audio: WhatsAppMessageType.AUDIO,
      file: WhatsAppMessageType.DOCUMENT,
      location: WhatsAppMessageType.LOCATION,
    };
    return {
      hasMessage: true,
      type: ATT_MAP[att.type] ?? WhatsAppMessageType.UNSUPPORTED,
      body: null,
      preview: `[${att.type}]`,
      payload: { attachment: att },
      mediaUrl: att.payload?.url ?? null,
    };
  }
  if (ev.postback) {
    const body = ev.postback.title ?? ev.postback.payload ?? '[postback]';
    return { hasMessage: true, type: WhatsAppMessageType.SYSTEM, body, preview: body.slice(0, 140), payload: { postback: ev.postback }, mediaUrl: null };
  }
  // Pure referral / receipt — thread gets updated for attribution, no message row.
  return { hasMessage: false, type: WhatsAppMessageType.UNSUPPORTED, body: null, preview: '[referral]', payload: null, mediaUrl: null };
}
