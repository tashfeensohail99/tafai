import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { LeadImportRowOutcome, LeadImportStatus, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { LeadAssignmentService } from '../../lead-assignment/lead-assignment.service';
import { generateLeadReferenceCode } from '../../../common/reference-codes/reference-codes';
import { normalisePhone } from '../../../common/phone/phone.util';
import { findLeadByNormalizedPhone } from '../../../common/phone/lead-dedupe';
import { findClientByNormalizedPhone } from '../../../common/phone/client-dedupe';
import { parseSpreadsheet } from '../parsers/spreadsheet-parser';
import { LEAD_IMPORT_QUEUE, type LeadImportJob } from '../queue-contracts';
import {
  WHATSAPP_QUEUE,
  type CsvDripJob,
} from '../../whatsapp/queues/queue-contracts';

/** Shape of the columnMapping JSONB on LeadImportBatch. */
interface ColumnMapping {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  alternatePhone?: string;
  nationality?: string;
  targetCountry?: string;
  serviceInterest?: string;
  city?: string;
  notes?: string;
  sourceLabel?: string;
}

/**
 * Lead-import worker. Downloads the source spreadsheet from S3, parses it,
 * walks every row applying the admin's column mapping, normalises phones,
 * dedupes against existing leads, creates new ones with sourceChannel='csv'
 * + round-robin assignment, and records every row's outcome in
 * `LeadImportRow` for the audit + error-CSV-download path.
 *
 * Lifecycle:
 *   QUEUED → PROCESSING → COMPLETED | FAILED | PAUSED
 *
 * Pause: the worker checks the batch's `status` between every row and
 * stops cleanly if it sees PAUSED. The job stays in BullMQ's failed bucket
 * with a known reason so a resume can re-enqueue from row N+1.
 *
 * Concurrency: 1. Lead creation grabs the next round-robin cursor and
 * advances it — running two import workers in parallel would race on the
 * cursor and double-assign. Tashfeen's volume is well within what a single
 * worker handles. If we ever need parallelism, partition by batch id.
 */
@Processor(LEAD_IMPORT_QUEUE, { concurrency: 1 })
export class LeadImportProcessor extends WorkerHost {
  private readonly log = new Logger(LeadImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly leadAssignment: LeadAssignmentService,
    @InjectQueue(WHATSAPP_QUEUE.CSV_DRIP)
    private readonly csvDripQueue: Queue<CsvDripJob>,
  ) {
    super();
  }

  /**
   * Kick off the 2-touch WhatsApp template drip for a freshly imported (or
   * reconciled-existing) lead. Fire-and-forget: an enqueue hiccup must never
   * fail the import row. jobId is derived from the lead so a re-import / resume
   * can't double-schedule touch-1; the drip service also guards on
   * lead.dripTouch1At. A small per-row stagger spreads a big batch so touch-1
   * sends trickle out rather than bursting the business number.
   */
  private scheduleDrip(leadId: string, rowNumber: number): void {
    const delay = Math.min(rowNumber, 600) * 1_000;
    void this.csvDripQueue
      .add('touch1', { leadId, touch: 1 }, { jobId: `drip-${leadId}-t1`, delay })
      .catch((e) => this.log.warn(`CSV drip schedule failed for lead ${leadId}: ${(e as Error).message}`));
  }

  override async process(job: Job<LeadImportJob>): Promise<void> {
    const { batchId } = job.data;
    const batch = await this.prisma.leadImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      this.log.warn(`batch ${batchId} not found`);
      return;
    }
    if (batch.status !== LeadImportStatus.QUEUED && batch.status !== LeadImportStatus.PAUSED) {
      this.log.warn(`batch ${batchId} not in a runnable state: ${batch.status}`);
      return;
    }

    await this.prisma.leadImportBatch.update({
      where: { id: batchId },
      data: { status: LeadImportStatus.PROCESSING, startedAt: batch.startedAt ?? new Date() },
    });

    try {
      const file = await this.storage.download(batch.fileKey);
      const parsed = parseSpreadsheet(
        file.bytes,
        batch.fileMimeType ?? 'application/octet-stream',
        batch.fileName,
      );

      const mapping = batch.columnMapping as unknown as ColumnMapping;
      if (!mapping?.phone) {
        throw new Error('columnMapping.phone is required');
      }

      // Resume support — skip rows we already processed.
      const lastProcessed = await this.prisma.leadImportRow.aggregate({
        where: { batchId },
        _max: { rowNumber: true },
      });
      const startRow = (lastProcessed._max.rowNumber ?? 0) + 1;
      if (startRow > 1) {
        this.log.log(`batch ${batchId} resuming from row ${startRow}`);
      } else {
        await this.prisma.leadImportBatch.update({
          where: { id: batchId },
          data: { totalRows: parsed.totalRows },
        });
      }

      for (let idx = 0; idx < parsed.rows.length; idx += 1) {
        const rowNumber = idx + 1;
        if (rowNumber < startRow) continue;

        // Pause check — refetch the status row at the top of every iteration
        // so an admin clicking Pause in the UI takes effect within ~1 row.
        const current = await this.prisma.leadImportBatch.findUnique({
          where: { id: batchId },
          select: { status: true },
        });
        if (current?.status === LeadImportStatus.PAUSED) {
          this.log.log(`batch ${batchId} paused at row ${rowNumber}`);
          await this.prisma.leadImportBatch.update({
            where: { id: batchId },
            data: { pausedAt: new Date() },
          });
          return;
        }

        await this.processRow(batch.id, rowNumber, parsed.rows[idx]!, batch, mapping);
      }

      // Reconcile the batch's aggregate counters from the source-of-truth row
      // records before marking complete. The per-row counter bumps and the row
      // inserts are separate (non-transactional) writes, so if the worker is
      // restarted mid-batch — a BullMQ retry after a redeploy/crash — a row can
      // be recorded while its counter increment is lost on the resume (the row
      // is then skipped). That leaves the progress bar stuck a hair under 100%
      // (e.g. 36/37) even though every row was processed. Recomputing straight
      // from LeadImportRow here makes the final totals exact and self-healing.
      const grouped = await this.prisma.leadImportRow.groupBy({
        by: ['outcome'],
        where: { batchId },
        _count: { _all: true },
      });
      const countOf = (o: LeadImportRowOutcome): number =>
        grouped.find((g) => g.outcome === o)?._count._all ?? 0;
      const assignedCount = await this.prisma.leadImportRow.count({
        where: {
          batchId,
          outcome: LeadImportRowOutcome.IMPORTED,
          assignedEmployeeId: { not: null },
        },
      });
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: {
          status: LeadImportStatus.COMPLETED,
          completedAt: new Date(),
          importedCount: countOf(LeadImportRowOutcome.IMPORTED),
          duplicateCount: countOf(LeadImportRowOutcome.DUPLICATE),
          invalidCount:
            countOf(LeadImportRowOutcome.INVALID) + countOf(LeadImportRowOutcome.FAILED),
          assignedCount,
        },
      });
      this.log.log(`batch ${batchId} completed`);
    } catch (err) {
      this.log.error(`batch ${batchId} failed: ${(err as Error).message}`);
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { status: LeadImportStatus.FAILED },
      });
      throw err;
    }
  }

  private async processRow(
    batchId: string,
    rowNumber: number,
    row: Record<string, string>,
    batch: { defaultCountry: string; uploadedByUserId: string; selectedAgentIds: string[] },
    mapping: ColumnMapping,
  ): Promise<void> {
    // Last-resort guard: a single row must NEVER crash the whole batch. The
    // inner handler already records create-failures per row, but the pre-create
    // steps (phone normalisation, dedupe, round-robin pick) could still throw on
    // a malformed row — which previously failed the entire import and exhausted
    // the worker's retries. Catch anything here, record the row as FAILED so it
    // shows in the error CSV, and let the rest of the batch proceed.
    try {
      await this.processRowInner(batchId, rowNumber, row, batch, mapping);
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown error';
      this.log.warn(`batch row ${rowNumber} crashed (recorded FAILED): ${message}`);
      try {
        await this.prisma.leadImportRow.create({
          data: {
            batchId,
            rowNumber,
            rawData: row as Prisma.InputJsonValue,
            outcome: LeadImportRowOutcome.FAILED,
            errorMessage: message.slice(0, 500),
          },
        });
        await this.prisma.leadImportBatch.update({
          where: { id: batchId },
          data: { invalidCount: { increment: 1 } },
        });
      } catch (e2) {
        this.log.error(`could not record crashed row ${rowNumber}: ${(e2 as Error).message}`);
      }
    }
  }

  private async processRowInner(
    batchId: string,
    rowNumber: number,
    row: Record<string, string>,
    batch: { defaultCountry: string; uploadedByUserId: string; selectedAgentIds: string[] },
    mapping: ColumnMapping,
  ): Promise<void> {
    const rawPhone = row[mapping.phone] ?? '';

    // 1. Normalise the phone first — bad phone → INVALID outcome.
    const normalised = normalisePhone(
      rawPhone,
      batch.defaultCountry as Parameters<typeof normalisePhone>[1],
    );
    if (!normalised.ok || !normalised.e164) {
      await this.prisma.leadImportRow.create({
        data: {
          batchId,
          rowNumber,
          rawData: row as Prisma.InputJsonValue,
          outcome: LeadImportRowOutcome.INVALID,
          errorMessage: `Phone ${normalised.reason ?? 'invalid'}: "${rawPhone}"`,
        },
      });
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { invalidCount: { increment: 1 } },
      });
      return;
    }

    // 2. Dedupe by normalised phone, so we catch an existing lead no matter how
    //    ITS number is stored — local "03xx…", "+92 3xx…", with spaces, etc. The
    //    old exact-e164 string match missed those format variants, re-created
    //    the lead, and it got assigned to a random rep instead of staying with
    //    whoever already owns/works it (e.g. a live WhatsApp chat). On a match we
    //    keep the existing lead + its current owner (recorded as DUPLICATE
    //    below); the helper returns the OLDEST match so the original owner wins.
    //
    //    This previously ran its own raw
    //    `RIGHT(regexp_replace(phone,'\D','','g'), $2::int) = $1` query. That can
    //    NEVER use an index (the length is a bind parameter, so it cannot match
    //    an expression index), so it did a full table scan with a regex per row —
    //    once PER IMPORTED ROW. A 500-row CSV meant 500 scans of every lead.
    //
    //    The shared helper is backed by `leads_phone_digits_idx` (~0.8ms) and is
    //    also SAFER: it matches explicit digit variants (92…/3…/03…) rather than
    //    "same last 10 digits", which stops a +1-333-678-7075 US lead being
    //    falsely merged with a PK number that shares those ten digits.
    const existing = await findLeadByNormalizedPhone(this.prisma, normalised.e164);
    // Also check clients — a customer already converted must never be
    // re-imported as a fresh lead. When a client matches, we route the
    // import row's DUPLICATE outcome to the client's sourceLeadId so the
    // manager sees it landed on the same person's original lead.
    const existingClient = !existing
      ? await findClientByNormalizedPhone(this.prisma, normalised.e164)
      : null;
    if (existing || existingClient) {
      const dupLeadId = existing?.id ?? existingClient?.sourceLeadId ?? null;
      const dupAssignedEmployeeId = existing?.assignedEmployeeId ?? null;
      await this.prisma.leadImportRow.create({
        data: {
          batchId,
          rowNumber,
          rawData: row as Prisma.InputJsonValue,
          normalisedPhone: normalised.e164,
          outcome: LeadImportRowOutcome.DUPLICATE,
          leadId: dupLeadId,
          assignedEmployeeId: dupAssignedEmployeeId,
        },
      });
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { duplicateCount: { increment: 1 } },
      });
      // Existing lead re-imported → it stays with its ORIGINAL owner (above).
      // Still send it the drip template (the drip service skips it if the lead
      // is already in an active conversation). If the match was via a CLIENT
      // (already converted), we skip the drip — reaching out to a paying
      // customer with an outbound-marketing template is not the right move.
      if (existing) this.scheduleDrip(existing.id, rowNumber);
      return;
    }

    // 3. Round-robin pick — same cursor as the WhatsApp engine so the
    //    overall workload is fair across CSV imports + live chats.
    const assigneeId = await this.pickNextAgent(batch.selectedAgentIds);

    // 4. Create the lead. Field mapping comes from the admin's column
    //    choices; everything except phone is optional.
    const referenceCode = await generateLeadReferenceCode(this.prisma);
    const cell = (field?: string): string | null => {
      if (!field) return null;
      const v = (row[field] ?? '').trim();
      return v || null;
    };

    // Name handling — accept either a split (firstName + lastName) or a
    // single "full_name" mapped to firstName. When lastName is unmapped
    // but firstName contains spaces, auto-split on the first whitespace
    // so a row like "Zahid Aslam" becomes firstName="Zahid", lastName="Aslam"
    // instead of firstName="Zahid Aslam", lastName=<phone tail>.
    let firstName = cell(mapping.firstName) ?? 'WhatsApp';
    let lastName = cell(mapping.lastName);
    if (!lastName && firstName.includes(' ')) {
      const parts = firstName.split(/\s+/);
      firstName = parts[0]!;
      lastName = parts.slice(1).join(' ');
    }
    if (!lastName) lastName = normalised.e164.slice(-4);

    try {
      const lead = await this.prisma.lead.create({
        data: {
          referenceCode,
          firstName,
          lastName,
          phone: normalised.e164,
          email: cell(mapping.email),
          alternatePhone: cell(mapping.alternatePhone),
          nationality: cell(mapping.nationality) ?? normalised.country ?? null,
          targetCountry: cell(mapping.targetCountry),
          serviceInterest: cell(mapping.serviceInterest),
          notes: cell(mapping.notes),
          // Free-form source label (e.g. "Facebook ads — May 2026"). We
          // also stamp the structured sourceChannel='csv-upload' below so
          // downstream filters/queries don't have to parse the label.
          sourceChannel: cell(mapping.sourceLabel) ?? 'csv-upload',
          assignedEmployeeId: assigneeId,
          preferredEmployeeId: assigneeId,
          status: LeadStatus.NEW,
          createdByUserId: batch.uploadedByUserId,
        },
      });

      await this.prisma.leadImportRow.create({
        data: {
          batchId,
          rowNumber,
          rawData: row as Prisma.InputJsonValue,
          normalisedPhone: normalised.e164,
          outcome: LeadImportRowOutcome.IMPORTED,
          leadId: lead.id,
          assignedEmployeeId: assigneeId,
        },
      });

      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: {
          importedCount: { increment: 1 },
          ...(assigneeId ? { assignedCount: { increment: 1 } } : {}),
        },
      });
      // New lead created → start its 2-touch WhatsApp template drip.
      this.scheduleDrip(lead.id, rowNumber);
    } catch (err) {
      // Lead.create could fail on unique constraints (race-condition
      // dedupe: two import jobs uploading the same number simultaneously)
      // or DB-level issues. Surface in the import-row record so admin can
      // download the error CSV and see which rows didn't make it.
      const message = (err as Error).message ?? 'unknown';
      await this.prisma.leadImportRow.create({
        data: {
          batchId,
          rowNumber,
          rawData: row as Prisma.InputJsonValue,
          normalisedPhone: normalised.e164,
          outcome: LeadImportRowOutcome.FAILED,
          errorMessage: message,
        },
      });
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { invalidCount: { increment: 1 } },
      });
      this.log.warn(`batch row ${rowNumber} failed: ${message}`);
    }
  }

  /**
   * Pick the next round-robin agent. Delegates to the shared
   * LeadAssignmentService so CSV imports, Meta Lead Forms, and live WhatsApp
   * all advance the same Organization.rrCursorEmployeeId cursor (fair overall
   * distribution). `selectedAgentIds` restricts the pool to a sub-team.
   */
  private async pickNextAgent(selectedAgentIds: string[]): Promise<string | null> {
    return this.leadAssignment.pickNextAgent(selectedAgentIds);
  }
}
