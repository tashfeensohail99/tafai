import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { LeadImportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
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
 * Header-name heuristics for the preview's "suggested mapping". We look at
 * each canonical lead field and pick the first header whose lower-cased
 * form contains any of the keywords below. Admin can override before they
 * trigger the actual import.
 */
const HEADER_HEURISTICS: Record<keyof ColumnMappingDto, string[]> = {
  phone: ['phone', 'mobile', 'whatsapp', 'cell', 'contact number', 'number'],
  firstName: ['first name', 'firstname', 'fname', 'name'],
  lastName: ['last name', 'lastname', 'lname', 'surname'],
  email: ['email', 'e-mail', 'mail'],
  alternatePhone: ['alternate', 'secondary phone', 'alt phone', 'other phone'],
  nationality: ['nationality', 'citizen'],
  targetCountry: ['target country', 'country of interest', 'destination', 'country'],
  serviceInterest: ['service', 'interested service', 'visa type', 'product'],
  city: ['city', 'town', 'location'],
  notes: ['notes', 'remarks', 'comment', 'description'],
  sourceLabel: ['source', 'campaign', 'channel'],
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
    const lowerHeaders = parsed.headers.map((h) => h.toLowerCase());
    for (const field of Object.keys(HEADER_HEURISTICS) as Array<keyof ColumnMappingDto>) {
      const keywords = HEADER_HEURISTICS[field];
      const matchIdx = lowerHeaders.findIndex((h) =>
        keywords.some((kw) => h === kw || h.includes(kw)),
      );
      if (matchIdx >= 0) {
        suggested[field] = parsed.headers[matchIdx];
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
        attempts: 1, // worker handles its own row-level errors; no retry on the whole batch
        removeOnComplete: { count: 100, age: 7 * 24 * 3600 },
        removeOnFail: { count: 100 },
      },
    );

    return batch;
  }

  async findAll(query: ListBatchesQueryDto) {
    return this.prisma.leadImportBatch.findMany({
      where: {
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
      where: { id },
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
        attempts: 1,
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
