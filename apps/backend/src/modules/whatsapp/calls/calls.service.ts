import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WhatsAppMessageDirection,
  WhatsAppMessageType,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OpenAiService } from '../../ai/openai.service';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';
import { WhatsAppRealtimePublisher } from '../realtime/publisher.service';
import { WHATSAPP_WS_EVENTS } from '../queues/queue-contracts';

/**
 * Phase 1 — live answering of inbound WhatsApp calls in the CRM.
 *
 * The browser does the WebRTC: it takes the SDP offer (stored on the call by
 * the webhook ingest), produces an SDP answer, and POSTs it here; we relay
 * `accept` + the answer to Meta. Reject / hang-up map to Meta `reject` /
 * `terminate`. Meta's call_id is the call row's `waCallId`.
 */
@Injectable()
export class WhatsAppCallsService {
  private readonly log = new Logger(WhatsAppCallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
    private readonly publisher: WhatsAppRealtimePublisher,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly openai: OpenAiService,
  ) {}

  // Cloudflare TURN mints SHORT-LIVED credentials; cache them well inside their
  // TTL so we don't call Cloudflare on every ICE fetch.
  private cfIceCache: { servers: unknown[]; expiresAt: number } | null = null;

  /** ICE servers for the RTCPeerConnection. Cloudflare TURN (anycast — each rep
   *  hits the nearest PoP, e.g. Karachi/Lahore, a fraction of the RTT to a single
   *  fixed relay, which is what makes calls connect fast + keeps audio two-way)
   *  first when configured, then the static STUN/coturn config as a fallback so
   *  calls still work if Cloudflare is ever unreachable. */
  async getIceServers(): Promise<{ iceServers: unknown }> {
    const fallback = (this.config.get('app.whatsapp.iceServers') as unknown[]) ?? [];
    const cf = await this.cloudflareIceServers();
    return { iceServers: cf ? [...cf, ...fallback] : fallback };
  }

  /** Mint (and cache) Cloudflare TURN ICE servers. Returns null when Cloudflare
   *  TURN isn't configured or the mint fails, so the caller falls back to the
   *  static config — a Cloudflare hiccup never takes calling down. */
  private async cloudflareIceServers(): Promise<unknown[] | null> {
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
    if (!keyId || !token) return null;
    if (this.cfIceCache && this.cfIceCache.expiresAt > Date.now()) return this.cfIceCache.servers;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 }),
          signal: ctrl.signal,
        },
      ).finally(() => clearTimeout(timer));
      if (!res.ok) {
        this.log.warn(`Cloudflare TURN mint failed: HTTP ${res.status} — using fallback ICE`);
        return null;
      }
      const data = (await res.json()) as { iceServers?: unknown[] };
      const servers = Array.isArray(data.iceServers) ? data.iceServers : null;
      if (!servers || servers.length === 0) return null;
      // Creds are valid 24h; re-mint every 12h to stay well inside the window.
      this.cfIceCache = { servers, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
      return servers;
    } catch (e) {
      this.log.warn(`Cloudflare TURN mint error: ${(e as Error).message} — using fallback ICE`);
      return null;
    }
  }

  /** Offer + status for the CallDock to set up its peer connection. */
  async getForDock(id: string) {
    const call = await this.prisma.whatsAppCall.findUnique({
      where: { id },
      select: { id: true, status: true, leadId: true, sdpOffer: true },
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  private async clientForCall(id: string) {
    const call = await this.prisma.whatsAppCall.findUnique({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { id: call.channelId } });
    if (!channel) throw new NotFoundException('Channel not found for call');
    return { call, client: this.metaFactory.forChannel(channel) };
  }

  /** Accept the call with the browser's SDP answer. */
  async answer(id: string, sdpAnswer: string, userId: string) {
    if (!sdpAnswer) throw new NotFoundException('Missing sdpAnswer');
    const { call, client } = await this.clientForCall(id);
    // A call can be answered exactly once. A duplicate accept (double-tap,
    // duplicated client event) would re-send a second SDP to Meta and poison
    // the already-established media session of the first answer.
    if (call.status === 'ANSWERED' || call.status === 'ENDED') {
      throw new ConflictException('Call already answered');
    }
    await client.respondToCall({ callId: call.waCallId, action: 'accept', sdpAnswer });
    const emp = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    await this.prisma.whatsAppCall.update({
      where: { id },
      data: {
        status: 'ANSWERED',
        sdpAnswer,
        answeredByEmployeeId: emp?.id ?? null,
        startedAt: call.startedAt ?? new Date(),
      },
    });
    this.log.log(`call ${id} answered by user ${userId}`);

    // Multi-device: the same inbound call may be ringing on this rep's phone AND
    // their laptop. Now that it's answered on ONE device, tell the rep's OTHER
    // clients to stop ringing via a socket event. The device that answered
    // ignores it (it's already 'connecting'/in-call, not 'ringing'); only
    // still-ringing clients tear down. Targets the answering employee AND the
    // lead's assigned rep (normally the same). Non-fatal: the call is already
    // answered, so a failed fan-out just lets other clients ring to their own
    // 45s timeout.
    //
    // We deliberately do NOT push an FCM 'call_cancelled' here: it would also
    // reach the ANSWERING phone and tear down the in-call CallKit/Telecom state
    // the app holds to survive Android doze — risking the media-drop the calling
    // code guards against. Dismissing a backgrounded phone's ring when the call
    // was answered on the WEB is a mobile-side follow-up (a ringing-only handler)
    // that ships with the next APK.
    try {
      const ringEmployeeIds = new Set<string>();
      if (emp?.id) ringEmployeeIds.add(emp.id);
      if (call.leadId) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: call.leadId },
          select: { assignedEmployeeId: true },
        });
        if (lead?.assignedEmployeeId) ringEmployeeIds.add(lead.assignedEmployeeId);
      }
      await Promise.all(
        [...ringEmployeeIds].map((empId) =>
          this.publisher.publishToEmployee(empId, WHATSAPP_WS_EVENTS.CALL_ANSWERED_ELSEWHERE, {
            callId: id,
          }),
        ),
      );
    } catch (err) {
      this.log.warn(
        `answered-elsewhere fan-out failed for call ${id}: ${(err as Error)?.message}`,
      );
    }
    return { ok: true };
  }

  /** Decline before answering. */
  async reject(id: string) {
    const { call, client } = await this.clientForCall(id);
    await client.respondToCall({ callId: call.waCallId, action: 'reject' });
    await this.prisma.whatsAppCall.update({
      where: { id },
      data: { status: 'ENDED', event: 'reject', endedAt: new Date() },
    });
    return { ok: true };
  }

  /** Hang up an answered call. */
  async hangup(id: string) {
    const { call, client } = await this.clientForCall(id);
    await client.respondToCall({ callId: call.waCallId, action: 'terminate' });
    const ended = await this.prisma.whatsAppCall.update({
      where: { id },
      data: {
        status: 'ENDED',
        event: 'terminate',
        endedAt: new Date(),
        durationSeconds: call.startedAt
          ? Math.max(0, Math.round((Date.now() - call.startedAt.getTime()) / 1000))
          : null,
      },
    });
    if (ended.answeredByEmployeeId) {
      await this.publisher.publishToEmployee(ended.answeredByEmployeeId, WHATSAPP_WS_EVENTS.CALL_ENDED, { callId: id });
    }
    return { ok: true };
  }

  /**
   * Liveness ping from the rep's client (~every 15s) while a call is connected.
   * The sweeper uses lastHeartbeatAt to detect a crashed tab/app and terminate
   * the orphaned Meta leg. Cheap + fire-and-forget; only touches ANSWERED calls,
   * and updateMany makes an unknown/ended id a harmless no-op.
   */
  async heartbeat(id: string, userId: string): Promise<{ ok: boolean }> {
    // Scoped to the rep ON the call (answeredByEmployeeId is set for inbound AND
    // outbound). Otherwise any authed employee who knew a call UUID could keep a
    // zombie alive. Fail-silent best-effort: a mismatch is a harmless no-op.
    const emp = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!emp) return { ok: true };
    await this.prisma.whatsAppCall.updateMany({
      where: { id, status: 'ANSWERED', answeredByEmployeeId: emp.id },
      data: { lastHeartbeatAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Per-call quality CDR posted by the client on hang-up (a getStats snapshot).
   * Best-effort: values are clamped to sane ranges and an unknown id is ignored,
   * so a malformed body can never break the rep's teardown.
   */
  async recordStats(
    id: string,
    dto: {
      endReason?: string;
      iceCandidateType?: string;
      rttMs?: number;
      jitterMs?: number;
      packetLossPct?: number;
      bytesSent?: number;
      bytesReceived?: number;
    },
    userId: string,
  ): Promise<{ ok: boolean }> {
    const emp = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!emp) return { ok: true };
    const clampInt = (v: unknown, max: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Math.round(v), max)) : null;
    const data: Prisma.WhatsAppCallUpdateManyMutationInput = {};
    // Whitelist endReason to the documented set so a client can't inject junk
    // into outcome analytics.
    const VALID_REASONS = ['hangup', 'caller-hangup', 'failed', 'reconnect-timeout', 'connect-timeout', 'ring-timeout', 'orphan-timeout'];
    if (typeof dto.endReason === 'string' && VALID_REASONS.includes(dto.endReason)) data.endReason = dto.endReason;
    if (['host', 'srflx', 'prflx', 'relay'].includes(String(dto.iceCandidateType))) {
      data.iceCandidateType = String(dto.iceCandidateType);
    }
    const rtt = clampInt(dto.rttMs, 60_000);
    const jit = clampInt(dto.jitterMs, 60_000);
    const sent = clampInt(dto.bytesSent, 2_000_000_000);
    const recv = clampInt(dto.bytesReceived, 2_000_000_000);
    if (rtt !== null) data.rttMs = rtt;
    if (jit !== null) data.jitterMs = jit;
    if (sent !== null) data.bytesSent = sent;
    if (recv !== null) data.bytesReceived = recv;
    if (typeof dto.packetLossPct === 'number' && Number.isFinite(dto.packetLossPct)) {
      data.packetLossPct = Math.max(0, Math.min(dto.packetLossPct, 100));
    }
    if (Object.keys(data).length === 0) return { ok: true };
    // Scoped to the rep on the call so one employee can't pollute another
    // call's CDR. A non-match is a harmless no-op.
    await this.prisma.whatsAppCall.updateMany({ where: { id, answeredByEmployeeId: emp.id }, data });
    return { ok: true };
  }

  /**
   * Periodic cleanup so a crashed client or an un-answered ring can't leave a
   * zombie (Meta leg alive, our row stuck). Driven by CallsSweeperService.
   *  - RINGING past RING_TTL → MISSED (Meta already ended the user-side ring;
   *    we just sync our row — the missed-call AI callback already fired on the
   *    webhook, so this is purely a state correction).
   *  - ANSWERED whose heartbeat went stale (rep's tab/app crashed) → terminate
   *    the Meta leg + ENDED(orphan-timeout). A freshly-answered call with no
   *    heartbeat YET is safe (only the null+very-old backstop catches those).
   */
  async sweepStaleCalls(): Promise<{ ringingMissed: number; orphansEnded: number }> {
    const now = Date.now();
    const RING_TTL_MS = 90_000;
    // 4 missed 15s beats — margin over the 30s sweep + 15s beat so a brief
    // network blip on a LIVE call can't trip a false orphan-termination.
    const HEARTBEAT_STALE_MS = 60_000;
    const HARD_TTL_MS = 3 * 60 * 60 * 1000;

    const missed = await this.prisma.whatsAppCall.updateMany({
      where: { status: 'RINGING', createdAt: { lt: new Date(now - RING_TTL_MS) } },
      data: { status: 'MISSED', event: 'ring-timeout', endReason: 'ring-timeout', endedAt: new Date() },
    });

    const zombies = await this.prisma.whatsAppCall.findMany({
      where: {
        status: 'ANSWERED',
        OR: [
          { lastHeartbeatAt: { lt: new Date(now - HEARTBEAT_STALE_MS) } },
          { lastHeartbeatAt: null, startedAt: { lt: new Date(now - HARD_TTL_MS) } },
        ],
      },
      select: { id: true, waCallId: true, channelId: true, answeredByEmployeeId: true, startedAt: true },
      take: 50,
    });

    let orphansEnded = 0;
    for (const z of zombies) {
      try {
        const channel = await this.prisma.whatsAppChannel.findUnique({ where: { id: z.channelId } });
        if (channel) {
          await this.metaFactory
            .forChannel(channel)
            .respondToCall({ callId: z.waCallId, action: 'terminate' })
            .catch(() => undefined); // Meta may already consider it ended — fine
        }
        // Guarded on status=ANSWERED so a concurrent real hangup wins the race.
        const res = await this.prisma.whatsAppCall.updateMany({
          where: { id: z.id, status: 'ANSWERED' },
          data: {
            status: 'ENDED',
            event: 'terminate',
            endReason: 'orphan-timeout',
            endedAt: new Date(),
            durationSeconds: z.startedAt ? Math.max(0, Math.round((now - z.startedAt.getTime()) / 1000)) : null,
          },
        });
        if (res.count > 0) {
          orphansEnded++;
          if (z.answeredByEmployeeId) {
            await this.publisher
              .publishToEmployee(z.answeredByEmployeeId, WHATSAPP_WS_EVENTS.CALL_ENDED, { callId: z.id })
              .catch(() => undefined);
          }
        }
      } catch (e) {
        this.log.warn(`sweep: orphan ${z.id} terminate failed: ${(e as Error).message}`);
      }
    }
    if (missed.count > 0 || orphansEnded > 0) {
      this.log.log(`call sweep: ${missed.count} ringing→missed, ${orphansEnded} orphan(s) terminated`);
    }
    return { ringingMissed: missed.count, orphansEnded };
  }

  /**
   * Admin calls history — org-wide list of WhatsApp calls (inbound + outbound)
   * with the contact, who handled it, status and duration. WhatsAppCall holds
   * only scalar cross-schema FKs (no Prisma relations), so display fields are
   * hydrated with a handful of batched `in` lookups rather than `include`.
   */
  async listHistory(opts: {
    limit?: number;
    before?: Date;
    direction?: string;
    status?: string;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const where: Prisma.WhatsAppCallWhereInput = {};
    if (opts.direction) where.direction = opts.direction;
    if (opts.status) where.status = opts.status;
    if (opts.before) where.createdAt = { lt: opts.before };

    const rows = await this.prisma.whatsAppCall.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        direction: true,
        status: true,
        event: true,
        threadId: true,
        leadId: true,
        clientId: true,
        assignedEmployeeId: true,
        answeredByEmployeeId: true,
        durationSeconds: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
        recordingKey: true,
        transcript: true,
        transcriptStatus: true,
        endReason: true,
        iceCandidateType: true,
        rttMs: true,
        jitterMs: true,
        packetLossPct: true,
      },
    });

    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    const threadIds = uniq(rows.map((r) => r.threadId));
    const leadIds = uniq(rows.map((r) => r.leadId));
    const clientIds = uniq(rows.map((r) => r.clientId));
    const empIds = uniq(rows.flatMap((r) => [r.assignedEmployeeId, r.answeredByEmployeeId]));

    const [threads, leads, clients, emps] = await Promise.all([
      threadIds.length
        ? this.prisma.whatsAppThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, waContactId: true } })
        : Promise.resolve([]),
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstName: true, lastName: true, phone: true } })
        : Promise.resolve([]),
      clientIds.length
        ? this.prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, firstName: true, lastName: true, phone: true } })
        : Promise.resolve([]),
      empIds.length
        ? this.prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([]),
    ]);

    const threadMap = new Map(threads.map((t) => [t.id, t] as const));
    const leadMap = new Map(leads.map((l) => [l.id, l] as const));
    const clientMap = new Map(clients.map((c) => [c.id, c] as const));
    const empMap = new Map(emps.map((e) => [e.id, e] as const));
    const empName = (id: string | null) => {
      if (!id) return null;
      const e = empMap.get(id);
      return e ? `${e.firstName} ${e.lastName}`.trim() || null : null;
    };

    const items = rows.map((r) => {
      const lead = r.leadId ? leadMap.get(r.leadId) : null;
      const client = r.clientId ? clientMap.get(r.clientId) : null;
      const thread = r.threadId ? threadMap.get(r.threadId) : null;
      const rawPhone = thread?.waContactId ?? lead?.phone ?? client?.phone ?? null;
      const phone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : null;
      const rawName = client
        ? `${client.firstName} ${client.lastName}`.trim()
        : lead
          ? `${lead.firstName} ${lead.lastName}`.trim()
          : '';
      // WhatsApp-only contacts are auto-named "WhatsApp <digits>" — show the
      // number instead of that placeholder.
      const contactName = rawName && !/^whatsapp\b/i.test(rawName) ? rawName : null;
      return {
        id: r.id,
        direction: r.direction,
        status: r.status,
        event: r.event,
        phone,
        contactName,
        contactType: r.clientId ? 'client' : r.leadId ? 'lead' : null,
        leadId: r.leadId,
        clientId: r.clientId,
        threadId: r.threadId,
        assignedEmployeeName: empName(r.assignedEmployeeId),
        answeredByEmployeeName: empName(r.answeredByEmployeeId),
        durationSeconds: r.durationSeconds,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        hasRecording: !!r.recordingKey,
        transcript: r.transcript,
        transcriptStatus: r.transcriptStatus,
        endReason: r.endReason,
        iceCandidateType: r.iceCandidateType,
        rttMs: r.rttMs,
        jitterMs: r.jitterMs,
        packetLossPct: r.packetLossPct,
      };
    });

    const nextBefore = rows.length === limit ? rows[rows.length - 1].createdAt : null;
    return { items, nextBefore };
  }

  /** KPI counters for the calls history header. Timezone-independent. */
  async callStats() {
    const [total, missed, answered, durAgg] = await Promise.all([
      this.prisma.whatsAppCall.count(),
      this.prisma.whatsAppCall.count({ where: { status: 'MISSED' } }),
      this.prisma.whatsAppCall.count({ where: { answeredByEmployeeId: { not: null } } }),
      this.prisma.whatsAppCall.aggregate({
        _avg: { durationSeconds: true },
        where: { durationSeconds: { gt: 0 } },
      }),
    ]);
    return {
      total,
      missed,
      answered,
      avgDurationSeconds: Math.round(durAgg._avg.durationSeconds ?? 0),
    };
  }

  // ── Outbound (business-initiated) calling ────────────────────────────────

  /** Resolve the acting user's employee row (the calling rep). */
  private async employeeIdForUser(userId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    return emp?.id ?? null;
  }

  /** Load a thread + its channel (for the Meta client), or 404. */
  private async threadWithChannel(threadId: string) {
    if (!threadId) throw new BadRequestException('Missing threadId');
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        channelId: true,
        waContactId: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
        callPermissionStatus: true,
        callPermissionExpiresAt: true,
      },
    });
    if (!thread) throw new NotFoundException('Conversation not found');
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { id: thread.channelId } });
    if (!channel) throw new NotFoundException('WhatsApp channel not found for conversation');
    return { thread, channel };
  }

  /**
   * Request permission to call this contact. Meta requires explicit opt-in
   * before ANY business-initiated call (an inbound call from them does not
   * count). Sends the interactive `call_permission_request` (needs an open 24h
   * window), records a display message, and marks the thread permission PENDING.
   */
  async requestCallPermission(threadId: string, userId: string) {
    const { thread, channel } = await this.threadWithChannel(threadId);
    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        'The 24-hour messaging window is closed — send a message first, then request call permission.',
      );
    }
    const senderEmployeeId = await this.employeeIdForUser(userId);
    const bodyText =
      'We’d like to call you on WhatsApp to discuss your application. ' +
      'It’s a free call over your internet connection. May we call you?';

    const client = this.metaFactory.forChannel(channel);
    let wamid: string | null = null;
    try {
      const res = await client.sendCallPermissionRequest({ to: thread.waContactId, bodyText });
      wamid = res.messages?.[0]?.id ?? null;
    } catch (err) {
      throw new BadGatewayException(
        err instanceof Error ? err.message : 'Could not send the call-permission request',
      );
    }

    await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: channel.id,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.SENT,
        body: `🔔 Requested permission to call. “${bodyText}”`,
        sentByEmployeeId: senderEmployeeId,
        waMessageId: wamid ?? undefined,
        payload: { callPermissionRequest: true } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.whatsAppThread.update({
      where: { id: thread.id },
      data: {
        callPermissionStatus: 'PENDING',
        callPermissionUpdatedAt: now,
        lastMessageAt: now,
        lastMessagePreview: '🔔 Call permission requested',
      },
    });
    this.log.log(`call-permission request sent for thread ${thread.id}`);
    return { ok: true };
  }

  /**
   * Place an OUTBOUND (business-initiated) call. The rep's browser supplies an
   * SDP OFFER; we relay it to Meta via action=connect. Meta enforces that the
   * user has granted call permission — a permission failure surfaces as a clear,
   * actionable error. On success we create the call row (RINGING) and return its
   * id; the user's SDP ANSWER arrives later on the connect webhook and is
   * relayed to the rep's browser via the CALL_ANSWERED event.
   */
  async initiateOutbound(threadId: string, sdpOffer: string, userId: string) {
    if (!sdpOffer) throw new BadRequestException('Missing SDP offer');
    const { thread, channel } = await this.threadWithChannel(threadId);
    const senderEmployeeId = await this.employeeIdForUser(userId);

    const client = this.metaFactory.forChannel(channel);
    let callId = '';
    try {
      const res = await client.initiateCall({ to: thread.waContactId, sdpOffer });
      callId = res.callId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not place the call';
      // Meta rejects calls when the user hasn't granted permission — translate
      // to a clear next step instead of a raw Meta error code.
      if (/permission|consent|not allowed|opt[- ]?in|1014|139\d{3}/i.test(msg)) {
        throw new BadRequestException(
          'This customer hasn’t allowed WhatsApp calls yet. Use “Request call permission” first, then call once they tap Allow.',
        );
      }
      throw new BadGatewayException(msg);
    }
    if (!callId) throw new BadGatewayException('Meta did not return a call id');

    const now = new Date();
    const callRow = await this.prisma.whatsAppCall.create({
      data: {
        threadId: thread.id,
        channelId: channel.id,
        leadId: thread.leadId,
        clientId: thread.clientId,
        waCallId: callId,
        direction: 'OUTBOUND',
        status: 'RINGING',
        event: 'connect',
        sdpOffer,
        assignedEmployeeId: senderEmployeeId,
        answeredByEmployeeId: senderEmployeeId,
        startedAt: now,
      },
      select: { id: true },
    });

    // A successful initiate means permission IS granted — reflect the hint
    // (valid ~7 days per Meta). Best-effort; never block the call on this.
    await this.prisma.whatsAppThread
      .update({
        where: { id: thread.id },
        data: {
          callPermissionStatus: 'GRANTED',
          callPermissionUpdatedAt: now,
          callPermissionExpiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
        },
      })
      .catch(() => undefined);

    this.log.log(`outbound call ${callRow.id} (waCallId ${callId}) initiated for thread ${thread.id}`);
    return { callId: callRow.id };
  }

  // ── Recording + transcription (internal QA / AI-training corpus) ──────────

  /**
   * Store a call recording (both sides, mixed + uploaded by the rep's browser
   * on hang-up) and kick off Whisper transcription in the background. Best-
   * effort: a failure here never affects the call.
   */
  async saveRecording(id: string, buffer: Buffer, mimeType: string, filename: string) {
    const call = await this.prisma.whatsAppCall.findUnique({ where: { id }, select: { id: true } });
    if (!call) throw new NotFoundException('Call not found');
    if (!buffer?.length) throw new BadRequestException('Empty recording');

    const mime = mimeType || 'audio/webm';
    const { key } = await this.storage.upload(
      buffer,
      mime,
      'whatsapp-call-recordings',
      filename || 'call.webm',
    );
    await this.prisma.whatsAppCall.update({
      where: { id },
      data: { recordingKey: key, recordingMimeType: mime, transcriptStatus: 'PENDING' },
    });

    // Transcribe in the background using the in-memory buffer (no re-download).
    void this.transcribeRecording(id, buffer, filename || 'call.webm');
    this.log.log(`recording stored for call ${id} (${buffer.length} bytes)`);
    return { ok: true };
  }

  /** Background Whisper transcription. Updates transcript + status; never throws. */
  private async transcribeRecording(id: string, buffer: Buffer, filename: string): Promise<void> {
    try {
      const res = await this.openai.transcribe(buffer, filename);
      await this.prisma.whatsAppCall.update({
        where: { id },
        data: { transcript: res?.text ?? null, transcriptStatus: res ? 'DONE' : 'FAILED' },
      });
      this.log.log(`transcript ${res ? 'done' : 'failed'} for call ${id}`);
    } catch (err) {
      this.log.error(`transcribe failed for call ${id}: ${(err as Error).message}`);
      await this.prisma.whatsAppCall
        .update({ where: { id }, data: { transcriptStatus: 'FAILED' } })
        .catch(() => undefined);
    }
  }

  /** Signed URL to play/download a call recording (admin). */
  async recordingSignedUrl(id: string) {
    const call = await this.prisma.whatsAppCall.findUnique({
      where: { id },
      select: { recordingKey: true, recordingMimeType: true },
    });
    if (!call?.recordingKey) throw new NotFoundException('No recording for this call');
    const url = await this.storage.getSignedUrl(call.recordingKey);
    return { url, mimeType: call.recordingMimeType ?? 'audio/webm' };
  }
}
