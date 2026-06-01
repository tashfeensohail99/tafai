import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
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
  ) {}

  /** ICE servers for the browser RTCPeerConnection (STUN always; TURN if configured). */
  getIceServers(): { iceServers: unknown } {
    return { iceServers: this.config.get('app.whatsapp.iceServers') ?? [] };
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
}
