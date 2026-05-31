import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppWebhookSignatureService } from '../meta/webhook-signature.service';
import { WHATSAPP_QUEUE, type WebhookIngestJob } from '../queues/queue-contracts';

// NUL (U+0000) built via fromCharCode so no literal NUL byte / escape lands in
// source. Postgres text/jsonb cannot store NUL; a webhook payload containing
// one makes whatsAppWebhookEvent.create() throw `22P05`, which 500s the
// endpoint — and because the ingest job is enqueued only AFTER that create
// succeeds, Meta retries the same payload forever and the inbound is never
// processed (dropped). stripNullBytes recursively removes NUL from object keys
// and string values so the forensic record persists cleanly; nothing else is
// altered.
const NUL_CHAR = String.fromCharCode(0);

function stripNullBytes(value: unknown): unknown {
  if (typeof value === 'string') return value.split(NUL_CHAR).join('');
  if (Array.isArray(value)) return value.map(stripNullBytes);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.split(NUL_CHAR).join('')] = stripNullBytes(v);
    }
    return out;
  }
  return value;
}

/**
 * Meta webhook receiver — the only public-facing surface of the WhatsApp
 * module besides the dashboard.
 *
 * Two endpoints:
 *  - GET  /whatsapp/webhooks/meta  →  Meta's subscribe handshake (echoes back
 *                                      hub.challenge if the verify token matches)
 *  - POST /whatsapp/webhooks/meta  →  inbound message + status events
 *
 * Hard rules:
 *  - Verify HMAC on every POST against the raw body. Spoofed traffic gets a
 *    200 (to avoid Meta retry storms) but is persisted with signatureValid=false.
 *  - Respond within 5 seconds. We only persist + enqueue here; the actual
 *    work happens in the ingest worker.
 *
 * Note: This route is mounted with raw body parsing in `main.ts` so the
 *       signature service can verify against the exact bytes Meta sent.
 */
@Controller('whatsapp/webhooks/meta')
export class WhatsAppWebhooksController {
  private readonly log = new Logger(WhatsAppWebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signature: WhatsAppWebhookSignatureService,
    private readonly config: ConfigService,
    @InjectQueue(WHATSAPP_QUEUE.WEBHOOK_INGEST)
    private readonly queue: Queue<WebhookIngestJob>,
  ) {}

  @Get()
  async verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): Promise<Response> {
    const expected = this.config.get<string>('app.whatsapp.webhookVerifyToken');
    if (!expected) {
      this.log.error('META_WEBHOOK_VERIFY_TOKEN not configured — handshake will always 403');
      return res.status(403).send('Forbidden');
    }
    if (mode === 'subscribe' && token === expected && challenge) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  @HttpCode(200)
  @Post()
  async receive(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const signatureHeader = req.headers['x-hub-signature-256']?.toString();
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));

    const signatureValid = this.signature.verify(rawBody, signatureHeader);
    let payload: unknown = {};
    try {
      // Strip NUL bytes the moment we parse — Postgres can't persist them and
      // the forensic create() below would otherwise 500 the entire webhook.
      payload = stripNullBytes(JSON.parse(rawBody.toString('utf8')));
    } catch {
      this.log.warn('Webhook body was not valid JSON');
    }

    const objectType =
      typeof payload === 'object' && payload && 'object' in payload
        ? String((payload as { object?: unknown }).object ?? '')
        : null;

    // Persist every event (valid or not) for forensics. Worker filters invalid ones.
    const event = await this.prisma.whatsAppWebhookEvent.create({
      data: {
        signature: signatureHeader ?? '',
        signatureValid,
        objectType,
        rawPayload: payload as object,
      },
    });

    if (!signatureValid) {
      this.log.warn(`Rejected webhook: invalid signature (eventId=${event.id})`);
      return res.status(200).send('ok');
    }

    await this.queue.add('ingest', { webhookEventId: event.id }, { jobId: event.id });
    return res.status(200).send('ok');
  }
}
