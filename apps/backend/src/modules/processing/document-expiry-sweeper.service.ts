import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DocumentItemStatus, ProcessingCaseStage } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Document-expiry sweeper (Phase 4b).
 *
 * An accepted document can lapse *during* a long case (PCC ~6mo, medical 12mo,
 * language 2yr). `validityExpiryDate` is written when a doc is accepted; this
 * sweeper is what NOTICES it passing — it flips a still-accepted, now-expired
 * document to EXPIRED so the checklist + submission gate reflect reality and the
 * doc gets re-collected.
 *
 * Scope + safety:
 *   - Only ACCEPTED items on PRE-submission cases (re-collecting after filing
 *     with the authority would be moot/disruptive).
 *   - "Expiring soon" is NOT flipped here — that stays a derived display on the
 *     still-ACCEPTED row, so we never un-accept a document that's still valid.
 *   - The flip is an atomic updateMany gated on status=ACCEPTED, so overlapping
 *     instances/ticks can't double-act. Bounded per pass.
 *
 * Mirrors the existing setInterval/onModuleInit sweeper pattern (sla-sweeper).
 */
const PRE_SUBMISSION_STAGES: ProcessingCaseStage[] = [
  ProcessingCaseStage.DOCUMENTS_COLLECTION,
  ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW,
  ProcessingCaseStage.DOCUMENTS_INCOMPLETE,
  ProcessingCaseStage.DOCUMENTS_COMPLETE,
  ProcessingCaseStage.READY_FOR_SUBMISSION,
];

@Injectable()
export class DocumentExpirySweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DocumentExpirySweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
  private static readonly BATCH = 200;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // First pass shortly after boot (staggered past migration/startup), then 6-hourly.
    setTimeout(
      () => void this.sweep().catch((e) => this.log.error(`expiry sweep failed: ${(e as Error).message}`)),
      90_000,
    );
    this.timer = setInterval(() => {
      void this.sweep().catch((e) => this.log.error(`expiry sweep failed: ${(e as Error).message}`));
    }, DocumentExpirySweeperService.INTERVAL_MS);
    this.log.log('Document-expiry sweeper started (6h interval)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (this.running) return; // never overlap a slow sweep with the next tick
    this.running = true;
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0); // expired = strictly before today (UTC)

      const candidates = await this.prisma.caseDocumentItem.findMany({
        where: {
          status: DocumentItemStatus.ACCEPTED,
          validityExpiryDate: { lt: today }, // nulls excluded automatically
          case: { stage: { in: PRE_SUBMISSION_STAGES } },
        },
        select: { id: true, caseId: true, documentName: true, validityExpiryDate: true },
        take: DocumentExpirySweeperService.BATCH,
      });
      if (candidates.length === 0) return;

      let flipped = 0;
      for (const c of candidates) {
        // Atomic claim — only the tick/instance that wins the flip records it.
        const res = await this.prisma.caseDocumentItem.updateMany({
          where: { id: c.id, status: DocumentItemStatus.ACCEPTED },
          data: { status: DocumentItemStatus.EXPIRED },
        });
        if (res.count !== 1) continue;
        flipped++;
        await this.prisma.processingAuditLog
          .create({
            data: {
              caseId: c.caseId,
              actorUserId: null,
              action: 'document_auto_expired',
              entityType: 'case_document_item',
              entityId: c.id,
              newValues: {
                status: 'EXPIRED',
                documentName: c.documentName,
                validUntil: c.validityExpiryDate
                  ? c.validityExpiryDate.toISOString().slice(0, 10)
                  : null,
                automated: true,
              },
            },
          })
          .catch(() => {
            /* audit is best-effort; the status flip already landed */
          });
      }
      if (flipped > 0) this.log.log(`expiry sweep: ${flipped} document(s) marked EXPIRED`);
    } finally {
      this.running = false;
    }
  }
}
