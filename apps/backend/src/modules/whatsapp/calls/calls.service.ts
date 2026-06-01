import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
}
