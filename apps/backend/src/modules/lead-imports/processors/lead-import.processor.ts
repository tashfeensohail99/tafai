import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { LeadImportRowOutcome, LeadImportStatus, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { LeadAssignmentService } from '../../lead-assignment/lead-assignment.service';
import { generateLeadReferenceCode } from '../../../common/reference-codes/reference-codes';
import { normalisePhone } from '../../../common/phone/phone.util';
import { parseSpreadsheet } from '../parsers/spreadsheet-parser';
import { LEAD_IMPORT_QUEUE, type LeadImportJob } from '../queue-contracts';

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
  ) {
    super();
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

      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { status: LeadImportStatus.COMPLETED, completedAt: new Date() },
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

    // 2. Dedupe — phone-only per the build spec. Email-only or
    //    phone+email matching can be added later if needed.
    const existing = await this.prisma.lead.findFirst({
      where: { phone: normalised.e164, deletedAt: null },
      select: { id: true, assignedEmployeeId: true },
    });
    if (existing) {
      await this.prisma.leadImportRow.create({
        data: {
          batchId,
          rowNumber,
          rawData: row as Prisma.InputJsonValue,
          normalisedPhone: normalised.e164,
          outcome: LeadImportRowOutcome.DUPLICATE,
          leadId: existing.id,
          assignedEmployeeId: existing.assignedEmployeeId,
        },
      });
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { duplicateCount: { increment: 1 } },
      });
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
