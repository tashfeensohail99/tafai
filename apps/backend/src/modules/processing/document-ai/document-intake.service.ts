import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import {
  InboundDocumentSource,
  InboundDocumentStatus,
  Prisma,
  ProcessingCaseStage,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { DocumentParserClient } from './document-parser.client';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import type { ParserRequest } from './document-ai.contracts';

/**
 * Phase E — turns an inbound WhatsApp media message into a triage-ready
 * InboundDocument on the sender's active processing case.
 *
 *   media rehosted -> [doc-intake queue] -> ingestWhatsAppMessage()
 *
 * Steps: resolve thread/message -> client -> active case (no-op if none) ->
 * fetch the rehosted bytes -> store a stable copy in processing storage ->
 * classify with the parser (best-effort; suggests a matching checklist item)
 * -> create a PENDING InboundDocument. An associate then files it into a slot
 * (WA-3) or discards it. We never auto-file — the channel is untrusted.
 */
@Injectable()
export class DocumentIntakeService {
  private readonly log = new Logger(DocumentIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: DocumentParserClient,
    private readonly config: ConfigService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  /** The admin-managed OpenAI key (single source of truth). Null if none set. */
  private async resolveOpenAiKey(): Promise<string | null> {
    try {
      return await this.apiKeys.getActiveKey('openai');
    } catch {
      return null;
    }
  }

  async ingestWhatsAppMessage(messageId: string): Promise<void> {
    const msg = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        mediaUrl: true,
        mediaMimeType: true,
        mediaSizeBytes: true,
        payload: true,
        leadId: true,
        clientId: true,
        thread: { select: { leadId: true, clientId: true } },
      },
    });
    if (!msg || !msg.mediaUrl) {
      this.log.warn(`intake: message ${messageId} missing or has no media — skipping`);
      return;
    }

    const clientId = msg.clientId ?? msg.thread?.clientId ?? null;
    const leadId = msg.leadId ?? msg.thread?.leadId ?? null;
    if (!clientId && !leadId) return;

    const orFilters: Prisma.ProcessingCaseWhereInput[] = [];
    if (clientId) orFilters.push({ clientId });
    if (leadId) orFilters.push({ leadId });

    const activeCase = await this.prisma.processingCase.findFirst({
      where: {
        OR: orFilters,
        stage: { notIn: [ProcessingCaseStage.COMPLETED, ProcessingCaseStage.CANCELLED] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        service: true,
        targetCountry: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            passportNumber: true,
            nationalId: true,
            cnic: true,
          },
        },
      },
    });
    if (!activeCase) {
      this.log.log(`intake: no active case for message ${messageId} — dropping`);
      return;
    }

    const bytes = await this.fetchWaMediaBytes(msg.mediaUrl);
    if (!bytes) {
      this.log.warn(`intake: could not fetch media bytes for message ${messageId}`);
      return;
    }

    const mime = msg.mediaMimeType ?? 'application/octet-stream';
    const ext = (mime.split('/')[1] ?? 'bin').split(';')[0];
    const fileName = this.payloadFileName(msg.payload) ?? `whatsapp-${messageId}.${ext}`;

    let storageKey: string;
    try {
      const up = await this.storage.upload(
        bytes,
        mime,
        `processing/cases/${activeCase.id}/inbound`,
        fileName,
      );
      storageKey = up.key;
    } catch (e) {
      this.log.warn(`intake: storage upload failed for ${messageId}: ${String(e)}`);
      return;
    }

    // Best-effort classification (needs the parser + OpenAI configured).
    let detectedDocType: string | null = null;
    let confidence: number | null = null;
    let suggestedItemId: string | null = null;
    if (this.parser.configured) {
      try {
        const c = activeCase.client;
        const signedUrl = await this.storage.getSignedUrl(storageKey);
        const req: ParserRequest = {
          caseId: activeCase.id,
          documentItemId: 'intake',
          versionId: `intake-${messageId}`,
          expected: {
            docType: null,
            documentKind: 'TEXT_DOCUMENT',
            documentName: fileName,
            validityRule: 'NONE',
            validityMonths: null,
            validityBufferDays: 0,
            photoSpec: null,
            clientName: c ? `${c.firstName} ${c.lastName}`.trim() : null,
            clientDob: c?.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : null,
            clientPassportNumber: c?.passportNumber ?? null,
            clientNationalId: c?.nationalId ?? c?.cnic ?? null,
            service: activeCase.service,
            targetCountry: activeCase.targetCountry,
          },
          file: { url: signedUrl, mimeType: mime, fileName },
          openaiApiKey: await this.resolveOpenAiKey(),
        };
        const resp = await this.parser.validate(req);
        detectedDocType = resp.detectedDocType;
        confidence = resp.confidence;
        suggestedItemId = await this.matchItem(activeCase.id, detectedDocType);
      } catch (e) {
        this.log.warn(`intake: classification failed for ${messageId}: ${String(e)}`);
      }
    }

    await this.prisma.inboundDocument.create({
      data: {
        caseId: activeCase.id,
        source: InboundDocumentSource.WHATSAPP,
        storageKey,
        fileName,
        mimeType: mime,
        fileSizeBytes: msg.mediaSizeBytes ?? bytes.length,
        whatsappMessageId: messageId,
        detectedDocType,
        classifyConfidence: confidence,
        suggestedItemId,
        status: InboundDocumentStatus.PENDING,
      },
    });
    this.log.log(
      `intake: InboundDocument created for case ${activeCase.id} (detected=${detectedDocType ?? 'n/a'})`,
    );
  }

  /** Best matching still-open checklist item for a detected doc-type. */
  private async matchItem(caseId: string, detected: string | null): Promise<string | null> {
    if (!detected) return null;
    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { caseId, docType: detected },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    return item?.id ?? null;
  }

  private payloadFileName(payload: Prisma.JsonValue | null): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    const doc = p['document'] as Record<string, unknown> | undefined;
    const fn = (doc?.['filename'] ?? p['filename']) as unknown;
    return typeof fn === 'string' && fn.length > 0 ? fn : null;
  }

  /**
   * Fetch the rehosted WhatsApp media. mediaUrl is either a full public URL
   * (when WHATSAPP_MEDIA_PUBLIC_BASE_URL is set) or a bare S3/R2 key — the same
   * bucket the media-download worker writes to.
   */
  private async fetchWaMediaBytes(mediaUrl: string): Promise<Buffer | null> {
    try {
      if (/^https?:\/\//i.test(mediaUrl)) {
        const res = await fetch(mediaUrl);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      }
      const s3 = this.makeWaS3();
      const bucket =
        this.config.get<string>('app.whatsapp.mediaBucket') ||
        this.config.get<string>('app.storage.bucket');
      if (!s3 || !bucket) return null;
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: mediaUrl }));
      const body = out.Body as Readable | undefined;
      if (!body) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return Buffer.concat(chunks);
    } catch (e) {
      this.log.warn(`intake: media fetch failed: ${String(e)}`);
      return null;
    }
  }

  private makeWaS3(): S3Client | null {
    const endpoint = this.config.get<string>('app.storage.endpoint');
    const accessKey = this.config.get<string>('app.storage.accessKey');
    const secretKey = this.config.get<string>('app.storage.secretKey');
    const region = this.config.get<string>('app.storage.region') ?? 'auto';
    if (!endpoint || !accessKey || !secretKey) return null;
    return new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
  }
}
