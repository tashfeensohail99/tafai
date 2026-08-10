import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { LeadImportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { matchAllTokens } from '../../common/search/multi-word-search';
import { StorageService } from '../storage/storage.service';
import { parseSpreadsheet } from './parsers/spreadsheet-parser';
import {
  LEAD_IMPORT_QUEUE,
  type LeadImportJob,
} from './queue-contracts';
import type {
  ColumnMappingDto,
  ListBatchesQueryDto,
  PreviewResultDto,
  StartImportDto,
} from './lead-imports.dto';

/**
 * Header-name heuristics for the preview's "suggested mapping". Two-stage
 * match: first try exact (case-insensitive) matches against the keywords
 * below, then fall back to substring matches. Substring-only used to grab
 * `ad_name` as firstName because both contain "name" — exact `full_name`
 * now wins firstName cleanly, and `ad_name` falls through to sourceLabel.
 *
 * Admin can override anything before triggering the import; this is just
 * a "try to save a few clicks" pass.
 */
const HEADER_HEURISTICS: Record<keyof ColumnMappingDto, { exact: string[]; partial: string[] }> = {
  phone: {
    exact: ['phone', 'mobile', 'whatsapp', 'cell', 'contact', 'number', 'phone number', 'mobile number', 'contact number'],
    partial: ['phone', 'mobile', 'whatsapp', 'cell'],
  },
  firstName: {
    exact: ['first name', 'firstname', 'fname', 'full name', 'fullname', 'name', 'full_name'],
    partial: ['first name', 'firstname', 'full name', 'fullname'],
  },
  lastName: {
    exact: ['last name', 'lastname', 'lname', 'surname', 'family name'],
    partial: ['last name', 'lastname', 'surname'],
  },
  email: {
    exact: ['email', 'e-mail', 'mail', 'email address'],
    partial: ['email', 'e-mail'],
  },
  alternatePhone: {
    exact: ['alternate phone', 'alt phone', 'secondary phone', 'other phone'],
    partial: ['alternate phone', 'alt phone', 'secondary phone'],
  },
  nationality: {
    exact: ['nationality', 'citizenship'],
    partial: ['nationality', 'citizen'],
  },
  targetCountry: {
    exact: ['target country', 'country of interest', 'destination', 'destination country'],
    partial: ['target country', 'country of interest', 'destination'],
  },
  serviceInterest: {
    exact: ['service', 'service interest', 'interested service', 'visa type', 'product'],
    partial: ['service', 'visa type'],
  },
  city: {
    exact: ['city', 'town', 'location'],
    partial: ['city'],
  },
  notes: {
    exact: ['notes', 'remarks', 'comment', 'comments', 'description'],
    partial: ['notes', 'remarks', 'comment'],
  },
  sourceLabel: {
    exact: ['source', 'campaign', 'ad_name', 'ad name', 'ad', 'channel', 'utm_source', 'campaign name'],
    partial: ['campaign', 'ad_name', 'ad name', 'utm_source'],
  },
};

@Injectable()
export class LeadImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(LEAD_IMPORT_QUEUE) private readonly queue: Queue<LeadImportJob>,
  ) {}

  /**
   * Read-only parse of an uploaded file. Returns the header row + first 10
   * data rows + a best-guess column mapping for the admin's review screen.
   * Nothing is persisted; this endpoint is safe to call repeatedly while
   * the admin tweaks the mapping.
   */
  preview(file: { buffer: Buffer; mimetype: string; originalname: string }): PreviewResultDto {
    const parsed = parseSpreadsheet(file.buffer, file.mimetype, file.originalname);
    const sampleRows = parsed.rows.slice(0, 10);

    const suggested: Partial<Record<keyof ColumnMappingDto, string>> = {};
    const lowerHeaders = parsed.headers.map((h) => h.toLowerCase().trim());
    const used = new Set<number>();

    // Pass 1: exact matches. A header used by one field doesn't get reused
    // by another (avoids `ad_name` and `full_name` both fighting for the
    // same column under firstName's substring rule).
    for (const field of Object.keys(HEADER_HEURISTICS) as Array<keyof ColumnMappingDto>) {
      const { exact } = HEADER_HEURISTICS[field];
      const idx = lowerHeaders.findIndex(
        (h, i) => !used.has(i) && exact.includes(h),
      );
      if (idx >= 0) {
        suggested[field] = parsed.headers[idx];
        used.add(idx);
      }
    }

    // Pass 2: substring matches for anything still unmapped. Still respects
    // the `used` set so we never double-bind.
    for (const field of Object.keys(HEADER_HEURISTICS) as Array<keyof ColumnMappingDto>) {
      if (suggested[field]) continue;
      const { partial } = HEADER_HEURISTICS[field];
      const idx = lowerHeaders.findIndex(
        (h, i) => !used.has(i) && partial.some((kw) => h.includes(kw)),
      );
      if (idx >= 0) {
        suggested[field] = parsed.headers[idx];
        used.add(idx);
      }
    }

    return {
      headers: parsed.headers,
      sampleRows,
      totalRows: parsed.totalRows,
      suggestedMapping: suggested,
      sourceFormat: parsed.sourceFormat,
    };
  }

  /**
   * Save the file to storage, create the batch row, enqueue the worker.
   * Returns the new batch immediately — the worker updates counts + status
   * asynchronously and the UI polls GET /:id for progress.
   */
  async start(
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    dto: StartImportDto,
    userId: string,
  ) {
    if (!dto.columnMapping?.phone) {
      throw new BadRequestException('columnMapping.phone is required');
    }

    // Re-parse here just to surface obvious problems (unsupported format,
    // header missing) BEFORE we persist the batch. The worker will re-parse
    // the same bytes from S3 to walk the rows.
    parseSpreadsheet(file.buffer, file.mimetype, file.originalname);

    const uploaded = await this.storage.upload(
      file.buffer,
      file.mimetype,
      'lead-imports',
      file.originalname,
    );

    const batchNumber = await this.generateBatchNumber();
    const batch = await this.prisma.leadImportBatch.create({
      data: {
        batchNumber,
        name: dto.name,
        uploadedByUserId: userId,
        fileName: file.originalname,
        fileKey: uploaded.key,
        fileMimeType: file.mimetype,
        fileSizeBytes: file.size,
        selectedAgentIds: dto.selectedAgentIds ?? [],
        columnMapping: dto.columnMapping as unknown as Prisma.InputJsonValue,
        defaultCountry: (dto.defaultCountry ?? 'PK').toUpperCase(),
        welcomeMessage: dto.welcomeMessage ?? null,
        status: LeadImportStatus.QUEUED,
      },
    });

    await this.queue.add(
      'process',
      { batchId: batch.id },
      {
        jobId: `lead-import-${batch.id}`,
        // 3 attempts with exponential backoff: handles the common case
        // of a Railway redeploy killing the worker mid-batch. The worker
        // is idempotent (skips rows where MAX(rowNumber) < startRow), so
        // retries resume cleanly rather than re-importing.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100, age: 7 * 24 * 3600 },
        removeOnFail: { count: 100 },
      },
    );

    return batch;
  }

  async findAll(query: ListBatchesQueryDto) {
    return this.prisma.leadImportBatch.findMany({
      where: {
        // Soft-deleted batches are hidden from the list — when admin deletes
        // a batch we cascade soft-delete every Lead it created and stamp
        // deletedAt on the batch row, so the batch vanishes from this view.
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { batchNumber: { contains: query.search, mode: 'insensitive' } },
                { fileName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        uploadedBy: { select: { id: true, email: true } },
      },
      orderBy: { uploadedAt: 'desc' },
      take: 100,
    });
  }

  async findById(id: string) {
    const batch = await this.prisma.leadImportBatch.findUnique({
      where: { id, deletedAt: null },
      include: {
        uploadedBy: { select: { id: true, email: true } },
        // Per-agent breakdown via groupBy isn't expressible in this include;
        // the controller fetches it separately via a service helper below.
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  /**
   * List the leads created by this batch — drives the "Leads in this batch"
   * panel on the detail page. Pulls through LeadImportRow so we only return
   * rows whose outcome was IMPORTED (those that became a Lead the batch
   * actually owns); DUPLICATE / INVALID rows are not shown because they
   * don't represent a deletable lead.
   *
   *   search   — case-insensitive against firstName / lastName / phone /
   *              email / referenceCode. Empty string = no filter.
   *   assignedEmployeeId — restrict to one agent. "unassigned" matches
   *              rows whose assignedEmployeeId is null. Omit = all.
   *
   * Capped at 500 rows so the UI doesn't choke on huge batches; the search
   * bar is the intended way to narrow down beyond that.
   */
  async listLeadsInBatch(
    batchId: string,
    opts: { search?: string; assignedEmployeeId?: string } = {},
  ): Promise<
    Array<{
      id: string;
      firstName: string;
      lastName: string;
      phone: string;
      email: string | null;
      status: string;
      referenceCode: string;
      assignedEmployee: { id: string; firstName: string; lastName: string } | null;
      createdAt: Date;
    }>
  > {
    await this.findById(batchId); // 404s if the batch is gone

    const search = opts.search?.trim();
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      importRows: { some: { batchId, outcome: 'IMPORTED' } },
      ...(opts.assignedEmployeeId === 'unassigned'
        ? { assignedEmployeeId: null }
        : opts.assignedEmployeeId
          ? { assignedEmployeeId: opts.assignedEmployeeId }
          : {}),
      // Multi-word: each token must hit ONE of the fields. Same fix as #269.
      ...(matchAllTokens(search, (tok): Prisma.LeadWhereInput => ({
        OR: [
          { firstName: { contains: tok, mode: 'insensitive' } },
          { lastName: { contains: tok, mode: 'insensitive' } },
          { phone: { contains: tok } },
          { email: { contains: tok, mode: 'insensitive' } },
          { referenceCode: { contains: tok, mode: 'insensitive' } },
        ],
      })) ?? {}),
    };

    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        referenceCode: true,
        createdAt: true,
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ assignedEmployeeId: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    return leads.map((l) => ({ ...l, status: l.status as string }));
  }

  /**
   * Bulk-delete a batch and every Lead created from it. Soft-delete throughout
   * — both the LeadImportBatch and the linked Lead rows have their deletedAt
   * stamped, and downstream queries (admin/sales lead lists, WhatsApp inbox
   * filtered on lead.deletedAt, lead-imports list) all skip deleted rows.
   *
   * Cascade scope: only leads whose import outcome was IMPORTED — those are
   * the ones THIS batch actually created. DUPLICATE outcomes point to pre-
   * existing leads owned by other sources, so we leave those alone. INVALID
   * and FAILED outcomes never created a lead in the first place.
   *
   * Idempotent: calling twice has no effect on already-deleted rows because
   * the WHERE clause matches `deletedAt: null`.
   */
  async deleteBatch(id: string, actorUserId: string): Promise<{ deletedLeads: number }> {
    const batch = await this.findById(id);
    // Collect lead ids the batch actually created. Using a Prisma findMany
    // rather than a bulk updateMany-by-join because Prisma can't filter by
    // a relation field in updateMany.
    const importedRows = await this.prisma.leadImportRow.findMany({
      where: { batchId: batch.id, outcome: 'IMPORTED' },
      select: { leadId: true },
    });
    const leadIds = importedRows
      .map((r) => r.leadId)
      .filter((x): x is string => !!x);

    const now = new Date();
    // Wrap in a transaction so we don't end up with a half-deleted batch.
    await this.prisma.$transaction([
      ...(leadIds.length
        ? [
            this.prisma.lead.updateMany({
              where: { id: { in: leadIds }, deletedAt: null },
              data: { deletedAt: now },
            }),
          ]
        : []),
      this.prisma.leadImportBatch.update({
        where: { id: batch.id },
        data: { deletedAt: now },
      }),
    ]);

    // Audit log entry on the batch — useful for "why did 188 leads disappear?"
    // forensics later. Reuse the generic USER_UPDATED action since we don't
    // have a LEAD_IMPORT_DELETED enum value (adding one would require an
    // extra migration just for the log label).
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'USER_UPDATED' as Prisma.AuditLogCreateInput['action'],
        entityType: 'LeadImportBatch',
        entityId: batch.id,
        oldValues: { deletedAt: null } as Prisma.InputJsonValue,
        newValues: {
          deletedAt: now.toISOString(),
          batchNumber: batch.batchNumber,
          cascadedLeads: leadIds.length,
        } as Prisma.InputJsonValue,
      },
    });

    return { deletedLeads: leadIds.length };
  }

  /**
   * Per-agent imported/assigned counts for the batch detail page.
   * Returns rows like { assignedEmployeeId, count } so the UI can show
   * "Sales Agent A: 87 leads, Sales Agent B: 92 leads".
   */
  async agentBreakdown(batchId: string) {
    const groups = await this.prisma.leadImportRow.groupBy({
      by: ['assignedEmployeeId'],
      where: { batchId, outcome: 'IMPORTED' },
      _count: { assignedEmployeeId: true },
    });
    if (groups.length === 0) return [];
    const ids = groups
      .map((g) => g.assignedEmployeeId)
      .filter((id): id is string => !!id);
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    const map = new Map(employees.map((e) => [e.id, e]));
    return groups.map((g) => ({
      employeeId: g.assignedEmployeeId,
      employeeName: g.assignedEmployeeId
        ? `${map.get(g.assignedEmployeeId)?.firstName ?? ''} ${map.get(g.assignedEmployeeId)?.lastName ?? ''}`.trim()
        : 'Unassigned',
      count: g._count.assignedEmployeeId,
    }));
  }

  /**
   * Toggle a running batch between PROCESSING ↔ PAUSED. The worker checks
   * the status at the top of every row loop, so a pause takes effect
   * within roughly one row's processing time (sub-second for normal files).
   */
  async setPaused(id: string, paused: boolean) {
    const batch = await this.findById(id);
    if (paused) {
      if (batch.status !== LeadImportStatus.PROCESSING && batch.status !== LeadImportStatus.QUEUED) {
        throw new BadRequestException(`Cannot pause a batch in ${batch.status} state`);
      }
      return this.prisma.leadImportBatch.update({
        where: { id },
        data: { status: LeadImportStatus.PAUSED, pausedAt: new Date() },
      });
    }
    if (batch.status !== LeadImportStatus.PAUSED) {
      throw new BadRequestException(`Cannot resume a batch in ${batch.status} state`);
    }
    await this.prisma.leadImportBatch.update({
      where: { id },
      data: { status: LeadImportStatus.QUEUED, pausedAt: null },
    });
    // Re-enqueue so the worker picks it up again.
    await this.queue.add(
      'process',
      { batchId: id },
      {
        jobId: `lead-import-${id}-resume-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100, age: 7 * 24 * 3600 },
        removeOnFail: { count: 100 },
      },
    );
    return this.findById(id);
  }

  private async generateBatchNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const count = await this.prisma.leadImportBatch.count({
        where: { createdAt: { gte: yearStart, lt: yearEnd } },
      });
      const candidate = `LB-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
      const existing = await this.prisma.leadImportBatch.findUnique({
        where: { batchNumber: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    throw new Error('Unable to generate unique batch number');
  }
}
