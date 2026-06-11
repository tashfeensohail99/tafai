import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
// Voice-note transcoding uses the system ffmpeg installed in the runtime image
// via apk (see apps/backend/Dockerfile, runner stage). We deliberately do NOT
// use the `ffmpeg-static` npm package: its post-install downloads the binary
// from a GitHub release at `npm ci` time, which intermittently returns 504 and
// fails the entire deploy. The apk package is deterministic and baked into the
// image layer, so builds no longer depend on an external download.
const FFMPEG_BIN = 'ffmpeg';
import {
  Prisma,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../queues/queue-contracts';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';
import { MetaApiError } from '../meta/cloud-client';

interface CallerContext {
  userId: string;
  employeeId: string | null;
  canViewAll: boolean;
  /**
   * Finance closed-loop scope: caller may see/send on threads only for
   * leads where Sales has sent an agreement (status != DRAFT).
   */
  canViewFinanceScope?: boolean;
  /**
   * Processing closed-loop scope: caller may see/send on threads only for
   * leads/clients that have a ProcessingCase.
   */
  canViewProcessingScope?: boolean;
}

interface SendTextInput {
  threadId: string;
  body: string;
  /** Optional Meta wa_message_id of a message being replied-to (in-chat quote). */
  contextWaMessageId?: string;
  /** Client-supplied idempotency key to dedupe accidental double-send. */
  idempotencyKey?: string;
}

interface SendTemplateInput {
  threadId: string;
  templateName: string;
  language: string;
  components?: Array<Record<string, unknown>>;
  idempotencyKey?: string;
}

interface SendMediaInput {
  threadId: string;
  /** Raw file buffer from the multipart upload. */
  file: Buffer;
  /** MIME type from Content-Type, e.g. audio/ogg or image/jpeg. */
  mimeType: string;
  /** Original filename, used for Meta upload and as document display name. */
  filename: string;
  /** Optional text caption shown below the media. */
  caption?: string;
  idempotencyKey?: string;
}

/**
 * Compose + enqueue outbound WhatsApp messages. The Meta send happens in the
 * outbound-message worker; this service only persists the Message row and
 * publishes the job.
 *
 * Enforced rules (UI cannot bypass):
 *   - 24-hour customer-service window: free-form text is allowed only when
 *     `WhatsAppThread.windowExpiresAt` is in the future. Outside the window
 *     callers must use a template message.
 *   - Agent scope: an agent can only send on threads whose Lead is assigned
 *     to them, unless they hold `whatsapp.view_all_inboxes`.
 */
@Injectable()
export class WhatsAppMessagesService {
  private readonly logger = new Logger(WhatsAppMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
    private readonly metaFactory: WhatsAppMetaClientFactory,
  ) {}

  async listForThread(
    caller: CallerContext,
    threadId: string,
    opts: { limit?: number; before?: Date; after?: Date } = {},
  ) {
    const thread = await this.thread(caller, threadId);
    const limit = Math.min(opts.limit ?? 50, 200);

    // `after` → tail fetch: ONLY messages newer than the cursor, ascending.
    // The open chat uses this to append just-arrived messages on a realtime
    // event instead of refetching the whole window every time. Uses the
    // [threadId, createdAt] index just like the default load.
    if (opts.after) {
      return this.prisma.whatsAppMessage.findMany({
        where: { threadId: thread.id, createdAt: { gt: opts.after } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: this.publicSelect(),
      });
    }

    const rows = await this.prisma.whatsAppMessage.findMany({
      where: {
        threadId: thread.id,
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: this.publicSelect(),
    });
    // Return chronological asc for the chat thread render.
    return rows.reverse();
  }

  async sendText(caller: CallerContext, input: SendTextInput) {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Message body must not be empty');

    const thread = await this.thread(caller, input.threadId);
    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.QUEUED,
        body,
        sentByEmployeeId: senderEmployeeId,
        repliedToWaMessageId: input.contextWaMessageId ?? null,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });

    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    // Stamp the thread so the AI bot stays silent for 4h after any human
    // reply. This rolls forward on every subsequent human send. Bot-sent
    // messages have senderEmployeeId=null and don't touch this stamp.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  async sendTemplate(caller: CallerContext, input: SendTemplateInput) {
    const thread = await this.thread(caller, input.threadId);
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);
    // Render the template's body with the supplied parameters so the chat
    // bubble + inbox preview show what the customer actually receives, instead
    // of a bare "Template: <name>" placeholder. Does NOT affect what's sent to
    // Meta (the processor still sends templateName + components).
    const renderedBody = await this.renderTemplateBody(
      thread.channelId,
      input.templateName,
      input.components,
    );
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEMPLATE,
        status: WhatsAppMessageStatus.QUEUED,
        templateName: input.templateName,
        templateLanguage: input.language,
        body: renderedBody,
        payload: { components: input.components ?? [] } as unknown as Prisma.InputJsonValue,
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });
    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    // Stamp the thread so the AI bot stays silent for 4h after any human
    // reply. This rolls forward on every subsequent human send. Bot-sent
    // messages have senderEmployeeId=null and don't touch this stamp.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Resolve a template's BODY text and fill its {{1}}, {{2}}… placeholders with
   * the parameters the agent supplied, so we can store the real message text on
   * the WhatsAppMessage row (used purely for our chat/inbox display — Meta gets
   * the structured template + components separately). Returns null when the
   * template or its body can't be resolved, so the UI falls back to a label.
   */
  private async renderTemplateBody(
    channelId: string,
    templateName: string,
    components: Array<Record<string, unknown>> | undefined,
  ): Promise<string | null> {
    try {
      const tpl = await this.prisma.whatsAppTemplate.findFirst({
        where: { channelId, name: templateName },
        select: { components: true },
      });
      const tplComps = (tpl?.components ?? []) as Array<{ type?: string; text?: string }>;
      const bodyText = tplComps.find((c) => (c.type ?? '').toUpperCase() === 'BODY')?.text;
      if (!bodyText) return null;
      const sent = (components ?? []) as Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
      const values =
        sent.find((c) => (c.type ?? '').toLowerCase() === 'body')?.parameters?.map((p) => p?.text ?? '') ?? [];
      return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] ?? `{{${n}}}`);
    } catch {
      return null;
    }
  }

  /**
   * Upload a media file to Meta, then enqueue the outbound media message.
   * Supports audio, image, video, and document types.
   */
  async sendMediaMessage(caller: CallerContext, input: SendMediaInput) {
    const thread = await this.thread(caller, input.threadId);
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);

    // Free-form media messages are subject to the same 24-hour window rule
    // as text messages. Templates are exempt but they don't use this method.
    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    // Voice notes (filename convention voice-note.*) skip strict MIME
    // validation — they're ALWAYS transcoded to Ogg/Opus below, and the
    // mobile app's multipart parts arrive as application/octet-stream.
    const isVoiceNote = input.filename.toLowerCase().startsWith('voice-note.');

    // Resolve Meta message type from the MIME type; clients that upload a
    // generic octet-stream (mobile multipart) fall back to the filename
    // extension so gallery attachments survive too.
    const effectiveMime = normalizeMediaMime(input.mimeType, input.filename);
    const mediaType = isVoiceNote ? 'audio' : resolveMediaType(effectiveMime);
    if (!mediaType) {
      throw new BadRequestException(`Unsupported media MIME type: ${input.mimeType}`);
    }

    // Get the WhatsApp channel settings to build the Meta client
    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { id: thread.channelId },
      select: { id: true, phoneNumberId: true, accessTokenEnc: true },
    });
    if (!channel) throw new NotFoundException('WhatsApp channel not found');

    const metaClient = this.metaFactory.forChannel(channel);

    // Upload to Meta — returns reusable media_id. Wrap any Meta-side
    // failure in a BadGateway with the actual error code/title/message
    // so the frontend can show "(#131009) Parameter value is not valid"
    // instead of the bare "Internal server error" that NestJS produces
    // for an unhandled non-HttpException.
    // Voice notes require OGG/OPUS format — transcode if the client recorded
    // in a different format (e.g. audio/mp4 on Chrome, audio/webm elsewhere).
    let uploadBuffer = input.file;
    let uploadMimeType = effectiveMime;
    let uploadFilename = input.filename;

    if (isVoiceNote) {
      // ALWAYS transcode voice notes to clean Ogg/Opus — never trust the
      // browser's declared MIME. Raw MediaRecorder output is wrapped in
      // containers Meta's media pipeline rejects:
      //   • Chrome / Edge record WebM/Opus       → sniffs as video/webm
      //   • Safari / iOS record MP4/AAC          → sniffs as video/mp4
      //   • Chrome even mislabels its WebM blob as "audio/ogg;codecs=opus"
      // In every case Meta ACCEPTS the upload (we declare a valid audio
      // type) but then fails DELIVERY with error 131053 "Media upload
      // error … on processing it is of type application/octet-stream".
      // Re-muxing through ffmpeg yields a single-stream Ogg/Opus file that
      // libmagic — and therefore Meta — identifies as audio/ogg. Verified
      // empirically: ffmpeg output → audio/ogg (accepted); every raw
      // browser blob → video/webm | video/mp4 (rejected).
      try {
        uploadBuffer = await this.transcodeVoiceToOgg(input.file);
        if (uploadBuffer.length < 64) {
          throw new Error(`transcode produced only ${uploadBuffer.length} bytes`);
        }
        uploadMimeType = 'audio/ogg';
        uploadFilename = 'voice-note.ogg';
        this.logger.debug(
          `Transcoded voice note from ${input.mimeType} → audio/ogg (${input.file.length} → ${uploadBuffer.length} bytes)`,
        );
      } catch (err) {
        // A voice note that can't be transcoded cannot be delivered — the
        // raw blob is guaranteed to 131053 on Meta's side. Fail loudly now
        // so the agent gets an immediate, actionable error instead of a
        // message that silently rots to FAILED minutes later via webhook.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Voice note transcode failed for thread=${thread.id} (${reason})`,
        );
        throw new BadGatewayException(
          'Voice note could not be processed for sending. Please try again.',
        );
      }
    }

    let metaMediaId: string;
    try {
      metaMediaId = await metaClient.uploadMedia(
        uploadBuffer,
        uploadMimeType,
        uploadFilename,
      );
    } catch (err) {
      if (err instanceof MetaApiError) {
        const detail = err.detail;
        const message = detail.title
          ? `Meta rejected media upload: ${detail.title} — ${detail.message}`
          : `Meta rejected media upload: ${detail.message}`;
        this.logger.error(
          `uploadMedia failed for thread=${thread.id} mime=${input.mimeType} bytes=${input.file.length}: code=${detail.code} message=${detail.message}`,
        );
        throw new BadGatewayException({
          message,
          metaCode: detail.code,
          metaTitle: detail.title,
          metaMessage: detail.message,
          fbtraceId: detail.fbtrace_id,
        });
      }
      const reason = err instanceof Error ? err.message : 'Unknown upload error';
      this.logger.error(
        `uploadMedia threw non-Meta error for thread=${thread.id} mime=${input.mimeType}: ${reason}`,
      );
      throw new BadGatewayException(`Media upload failed: ${reason}`);
    }

    // Map MIME type → WhatsApp message type enum
    const messageType =
      mediaType === 'image'
        ? WhatsAppMessageType.IMAGE
        : mediaType === 'video'
          ? WhatsAppMessageType.VIDEO
          : mediaType === 'document'
            ? WhatsAppMessageType.DOCUMENT
            : WhatsAppMessageType.AUDIO;

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: messageType,
        status: WhatsAppMessageStatus.QUEUED,
        mediaUrl: `meta:${metaMediaId}`,
        // Store the normalised mime type so streamMedia serves the correct
        // Content-Type and the processor knows the actual uploaded format.
        mediaMimeType: uploadMimeType,
        body: input.caption ?? null,
        // Mark as a voice note so the outbound worker sends voice:true (Meta
        // renders waveform + auto-play). By this point a voice note is
        // guaranteed to be Ogg/Opus — the transcode above either succeeded
        // or threw, so we never flag a non-Ogg file as a voice note.
        ...(isVoiceNote
          ? { payload: { isVoiceNote: true } as unknown as Prisma.InputJsonValue }
          : {}),
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });

    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    // Stamp the thread so the AI bot stays silent for 4h after any human
    // reply. This rolls forward on every subsequent human send. Bot-sent
    // messages have senderEmployeeId=null and don't touch this stamp.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Transcode any audio buffer to OGG/OPUS mono 16 kHz using ffmpeg.
   * Meta requires this exact format for voice notes (voice: true messages).
   * Falls back gracefully — callers should catch and upload the original.
   */
  private async transcodeVoiceToOgg(input: Buffer): Promise<Buffer> {
    const tmpIn = join(tmpdir(), `vn-in-${randomUUID()}`);
    const tmpOut = join(tmpdir(), `vn-out-${randomUUID()}.ogg`);
    try {
      await writeFile(tmpIn, input);
      // No input format hint — ffmpeg sniffs the container from the bytes,
      // so this handles WebM, MP4, Ogg, etc. transparently. Output is
      // mono Opus-in-Ogg, the format WhatsApp voice notes require.
      try {
        await execFileAsync(FFMPEG_BIN, [
          '-hide_banner',
          '-y',           // overwrite output
          '-i', tmpIn,
          '-c:a', 'libopus',
          '-ac', '1',     // mono (Meta voice-note requirement)
          '-ar', '16000', // 16 kHz — standard for speech
          '-application', 'voip',
          '-b:a', '32k',
          tmpOut,
        ]);
      } catch (e) {
        // execFile rejects with the captured stderr — surface its tail so
        // a broken/missing binary or undecodable input is diagnosable.
        const stderr = (e as { stderr?: unknown }).stderr;
        const tail = stderr
          ? ` — ${String(stderr).trim().split('\n').slice(-2).join(' ')}`
          : ` — ${(e as Error).message}`;
        throw new Error(`ffmpeg transcode failed${tail}`);
      }
      const out = await readFile(tmpOut);
      // Sanity-check the container: a real Ogg stream starts with the "OggS"
      // capture pattern. If it doesn't, Meta will store the upload as
      // application/octet-stream and fail delivery with 131053 — so reject
      // here with a clear reason instead of shipping bad bytes.
      const magic = out.subarray(0, 4).toString('latin1');
      if (magic !== 'OggS') {
        throw new Error(`ffmpeg output is not Ogg (magic="${magic}", ${out.length} bytes)`);
      }
      return out;
    } finally {
      await unlink(tmpIn).catch(() => {});
      await unlink(tmpOut).catch(() => {});
    }
  }

  /**
   * Decide which employee gets stamped on the outgoing message's
   * `sentByEmployeeId`. Two cases:
   *
   *   1. Caller IS an employee (sales agent, manager-in-pool, admin who's also
   *      in the WhatsApp pool) — stamp them. The thread reads naturally as
   *      that person speaking.
   *
   *   2. Caller is NOT an employee (super-admin / founder account with no
   *      Employee row) intervening in a sales agent's thread — stamp the
   *      thread's assigned agent so the conversation reads as one consistent
   *      voice from the customer's side. The customer never sees the
   *      attribution anyway (Meta only shows the business number) — this is
   *      purely about how the internal CRM thread renders. Falls back to null
   *      if neither caller nor thread has an employee (e.g. unassigned thread
   *      hit by a super-admin), which the schema allows.
   *
   * Audit of who *actually* clicked send is preserved via the JWT auth log
   * and ActivityTimeline, not via sentByEmployeeId.
   */
  private resolveSenderEmployeeId(
    caller: CallerContext,
    thread: { lead: { assignedEmployeeId: string | null } | null },
  ): string | null {
    if (caller.employeeId) return caller.employeeId;
    return thread.lead?.assignedEmployeeId ?? null;
  }

  /** Look up the thread, enforcing the agent-scope rule. */
  private async thread(caller: CallerContext, threadId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
        lead: { select: { id: true, assignedEmployeeId: true } },
      },
    });
    if (!t) throw new NotFoundException('Thread not found');
    if (!caller.canViewAll) {
      if (caller.canViewFinanceScope) {
        // Finance can only operate on threads whose lead has a
        // non-DRAFT agreement on file (closed-loop comms scope).
        if (!t.lead?.id) throw new ForbiddenException('Thread not visible to Finance');
        const hasAgreement = await this.prisma.agreement.findFirst({
          where: { leadId: t.lead.id, status: { not: 'DRAFT' }, deletedAt: null },
          select: { id: true },
        });
        if (!hasAgreement) {
          throw new ForbiddenException('Thread not visible to Finance until Sales sends an agreement');
        }
      } else if (caller.canViewProcessingScope) {
        // Processing may send only on a thread for one of their own clients
        // (lead/client has a ProcessingCase).
        const inProcessing = await this.prisma.processingCase.findFirst({
          where: {
            OR: [
              ...(t.leadId ? [{ leadId: t.leadId }] : []),
              ...(t.clientId ? [{ clientId: t.clientId }] : []),
            ],
          },
          select: { id: true },
        });
        if (!inProcessing) throw new ForbiddenException('Thread not in your processing scope');
      } else if (!caller.employeeId || t.lead?.assignedEmployeeId !== caller.employeeId) {
        throw new ForbiddenException('Thread not assigned to you');
      }
    }
    return t;
  }

  private publicSelect() {
    return {
      id: true,
      threadId: true,
      leadId: true,
      clientId: true,
      direction: true,
      type: true,
      status: true,
      body: true,
      payload: true,
      mediaUrl: true,
      mediaMimeType: true,
      templateName: true,
      templateLanguage: true,
      sentByEmployeeId: true,
      waMessageId: true,
      repliedToWaMessageId: true,
      errorCode: true,
      errorTitle: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      failedAt: true,
      adReferral: true,
      createdAt: true,
    } as const;
  }
}

/** Map inbound MIME type to one of Meta's media categories. */
function resolveMediaType(
  mimeType: string,
): 'audio' | 'image' | 'video' | 'document' | null {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base.startsWith('audio/')) return 'audio';
  if (base.startsWith('image/') && base !== 'image/webp') return 'image';
  if (base === 'image/webp') return 'image'; // sticker-like, treat as image
  if (base.startsWith('video/')) return 'video';
  const documentMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
  ];
  if (documentMimes.includes(base)) return 'document';
  return null;
}

/**
 * Best-effort MIME for clients that upload without declaring one (the
 * mobile app's multipart parts arrive as application/octet-stream): fall
 * back to the filename extension. Unknown extensions keep the original
 * MIME so the strict check above still rejects them.
 */
function normalizeMediaMime(mimeType: string, filename: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base && base !== 'application/octet-stream') return base;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    amr: 'audio/amr',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    '3gp': 'video/3gp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
  };
  return byExt[ext] ?? base;
}
