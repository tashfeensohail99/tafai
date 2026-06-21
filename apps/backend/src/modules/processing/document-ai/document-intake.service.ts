import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import {
  AuditAction,
  AuditCategory,
  AuditSeverity,
  InboundDocumentSource,
  InboundDocumentStatus,
  Prisma,
  ProcessingCaseStage,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DocumentParserClient } from './document-parser.client';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import type { ParserRequest, SplitParserDocument } from './document-ai.contracts';
import { parserDocTypeCandidates } from './document-doctype-map';

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
    // Central audit: inbound documents are created off the doc-intake queue
    // (driven by a client's WhatsApp media), bypassing HTTP and the global
    // AuditInterceptor.
    private readonly audit: AuditLogService,
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

    // Multi-document bundle? A client often dumps passport + bank statement +
    // photo as one combined PDF. Explode it into per-document triage rows.
    // Images are already single documents, so this only fires for PDFs and
    // falls through to the single-doc path on a single segment / any failure.
    const exploded = await this.explodeBundleToInbound({
      caseId: activeCase.id,
      service: activeCase.service,
      bytes,
      mime,
      baseName: fileName,
      source: InboundDocumentSource.WHATSAPP,
      whatsappMessageId: messageId,
    });
    if (exploded > 0) {
      this.log.log(
        `intake: message ${messageId} split into ${exploded} document(s) for case ${activeCase.id}`,
      );
      return;
    }

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

    const inboundDoc = await this.prisma.inboundDocument.create({
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
      select: { id: true },
    });
    this.auditInboundDocCreated(inboundDoc.id, activeCase.id, detectedDocType);
    this.log.log(
      `intake: InboundDocument created for case ${activeCase.id} (detected=${detectedDocType ?? 'n/a'})`,
    );
  }

  /**
   * Best matching checklist item for a parser-detected doc-type. Tries the raw
   * detected value first, then the mapped slot-vocab candidates in priority
   * order (parser vocab != checklist vocab — see document-doctype-map). Returns
   * the first slot the case actually has; null if none -> human picks.
   */
  private async matchItem(caseId: string, detected: string | null): Promise<string | null> {
    const candidates = parserDocTypeCandidates(detected);
    if (candidates.length === 0) return null;
    for (const docType of candidates) {
      const item = await this.prisma.caseDocumentItem.findFirst({
        where: { caseId, docType },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      if (item) return item.id;
    }
    return null;
  }

  /**
   * Split a combined upload into per-document triage rows. Shared by every
   * intake channel: WhatsApp media (no chosen slot), and the portal/officer
   * "safety net" (a bundle dumped into one slot — surface the extras).
   *
   * Returns the number of InboundDocuments created. Returns 0 when the file
   * isn't a PDF, the parser isn't configured, the split fails, or it resolves
   * to a single document — we only "explode" at >= 2 extractable segments, so a
   * normal single-document PDF is never needlessly chopped.
   *
   * `excludeSlotDocType` (portal/officer): the uploader already filed one slot
   * directly, so the matching segment is skipped — only the *extra* documents
   * become triage rows. WhatsApp passes none (no slot was chosen).
   *
   * Per the locked rule "never auto-act on splitting", each segment is created
   * PENDING with a suggested slot — the associate confirms each one via the
   * existing triage tray + fileInboundDocument flow, unchanged. This method is
   * self-contained (never rejects) so callers may fire it and forget.
   */
  async explodeBundleToInbound(opts: {
    caseId: string;
    service: string | null;
    bytes: Buffer;
    mime: string;
    baseName: string;
    source: InboundDocumentSource;
    whatsappMessageId?: string | null;
    excludeSlotDocType?: string | null;
  }): Promise<number> {
    const { caseId, service, bytes, mime, baseName, source } = opts;
    const whatsappMessageId = opts.whatsappMessageId ?? null;
    const excludeSlotDocType = opts.excludeSlotDocType ?? null;
    const label = whatsappMessageId ?? `${source}:${caseId}`;

    const isPdf = /pdf/i.test(mime) || bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf || !this.parser.configured) return 0;

    let usable: SplitParserDocument[];
    try {
      const resp = await this.parser.splitAndCategorize({
        file: { contentBase64: bytes.toString('base64'), mimeType: mime, fileName: baseName },
        caseId,
        expectedProgram: service,
      });
      usable = (resp.documents ?? []).filter((d) => d.fileBase64 && d.fileBase64.length > 0);
    } catch (e) {
      this.log.warn(`intake: split failed for ${label}: ${String(e)} — single-doc fallback`);
      return 0;
    }
    if (usable.length < 2) return 0; // single document (or no extractable segment)

    let created = 0;
    for (const seg of usable) {
      // Portal/officer: don't duplicate the segment the uploader already filed
      // into the chosen slot — only surface the extras.
      if (excludeSlotDocType && parserDocTypeCandidates(seg.doc_type).includes(excludeSlotDocType)) {
        continue;
      }
      try {
        const segBytes = Buffer.from(seg.fileBase64, 'base64');
        if (segBytes.length === 0) continue;
        const segExt = /pdf/i.test(seg.mimeType)
          ? 'pdf'
          : (seg.mimeType.split('/')[1] ?? 'bin').split(';')[0];
        const segName = `${this.stripExt(baseName)} — ${seg.doc_type}${this.pageRangeLabel(seg.pages)}.${segExt}`;
        const up = await this.storage.upload(
          segBytes,
          seg.mimeType,
          `processing/cases/${caseId}/inbound`,
          segName,
        );
        const suggestedItemId = await this.matchItem(caseId, seg.doc_type);
        const seg_doc = await this.prisma.inboundDocument.create({
          data: {
            caseId,
            source,
            storageKey: up.key,
            fileName: segName,
            mimeType: seg.mimeType,
            fileSizeBytes: segBytes.length,
            whatsappMessageId,
            detectedDocType: seg.doc_type,
            classifyConfidence: seg.confidence,
            suggestedItemId,
            status: InboundDocumentStatus.PENDING,
          },
          select: { id: true },
        });
        // Only WhatsApp-sourced bundles are inbound/webhook-driven; the
        // portal/officer split path is already audited at its HTTP route.
        if (source === InboundDocumentSource.WHATSAPP) {
          this.auditInboundDocCreated(seg_doc.id, caseId, seg.doc_type);
        }
        created++;
      } catch (e) {
        this.log.warn(`intake: segment file failed (${seg.doc_type}) for ${label}: ${String(e)}`);
      }
    }
    return created;
  }

  /**
   * Central-audit a freshly created inbound document from a client's WhatsApp
   * media. One row per created InboundDocument. actorUserId omitted = system
   * (webhook-driven, no human). Fire-and-forget — never break intake.
   */
  private auditInboundDocCreated(
    inboundDocId: string,
    caseId: string,
    classifiedType: string | null,
  ): void {
    void this.audit
      .log({
        action: AuditAction.DOCUMENT_UPLOADED,
        entityType: 'InboundDocument',
        entityId: inboundDocId,
        category: AuditCategory.WEBHOOK,
        severity: AuditSeverity.MEDIUM,
        metadata: { caseId, classifiedType: classifiedType ?? null },
      })
      .catch(() => undefined);
  }

  private stripExt(name: string): string {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  /** Human-friendly 1-based page range, e.g. " (pp 2-7)" or " (p3)" or "". */
  private pageRangeLabel(pages: number[]): string {
    if (!pages || pages.length === 0) return '';
    const first = pages[0] + 1;
    const last = pages[pages.length - 1] + 1;
    return first === last ? ` (p${first})` : ` (pp ${first}-${last})`;
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
