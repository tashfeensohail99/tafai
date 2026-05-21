import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { rowsToCsv, sendCsvDownload, todayStamp } from '../../common/csv/csv.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeadImportsService } from './lead-imports.service';
import { ListBatchesQueryDto, StartImportDto } from './lead-imports.dto';

@Controller('admin/lead-imports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeadImportsController {
  constructor(
    private readonly service: LeadImportsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Stateless parse-only endpoint. Admin uploads a file, gets back the
   * detected headers + first 10 rows + a best-guess column mapping. They
   * iterate on the mapping client-side until it looks right, then trigger
   * the actual import via POST /
   */
  @Post('preview')
  @RequirePermissions('leads.create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    }),
  )
  preview(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('A CSV or Excel file is required.');
    return this.service.preview(file);
  }

  /**
   * Kick off an import. Saves the file to storage, creates a QUEUED batch,
   * enqueues the worker, and returns the batch immediately. UI polls
   * GET /:id every 2s for progress.
   */
  @Post()
  @RequirePermissions('leads.create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  start(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: StartImportDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('A CSV or Excel file is required.');
    return this.service.start(file, dto, user.id);
  }

  @Get()
  @RequirePermissions('leads.create')
  findAll(@Query() query: ListBatchesQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('leads.create')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const batch = await this.service.findById(id);
    const breakdown = await this.service.agentBreakdown(id);
    return { ...batch, agentBreakdown: breakdown };
  }

  /**
   * Stream the per-row failure list as a downloadable CSV. Includes every
   * row that ended up INVALID or FAILED with the original cell values +
   * the error message — admin fixes the source file and re-uploads.
   */
  @Get(':id/errors.csv')
  @RequirePermissions('leads.create')
  async errorsCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const batch = await this.service.findById(id);
    const rows = await this.prisma.leadImportRow.findMany({
      where: { batchId: id, outcome: { in: ['INVALID', 'FAILED'] } },
      orderBy: { rowNumber: 'asc' },
    });
    type Row = (typeof rows)[number];
    const csv = rowsToCsv<Row>(rows, [
      { header: 'Row number', value: (r) => r.rowNumber },
      { header: 'Outcome', value: (r) => r.outcome },
      { header: 'Error', value: (r) => r.errorMessage },
      { header: 'Normalised phone', value: (r) => r.normalisedPhone },
      { header: 'Raw data', value: (r) => JSON.stringify(r.rawData) },
    ]);
    sendCsvDownload(res, `${batch.batchNumber}-errors-${todayStamp()}.csv`, csv);
  }

  /**
   * List leads created by this batch. Drives the "Leads in this batch"
   * panel on the detail page — admin can search by name/phone/email/ref,
   * filter by assigned agent (or "unassigned"), and delete individual
   * leads from the same view.
   */
  @Get(':id/leads')
  @RequirePermissions('leads.create')
  listLeads(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('search') search?: string,
    @Query('assignedEmployeeId') assignedEmployeeId?: string,
  ) {
    return this.service.listLeadsInBatch(id, {
      ...(search ? { search } : {}),
      ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
    });
  }

  @HttpCode(200)
  @Post(':id/pause')
  @RequirePermissions('leads.create')
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.setPaused(id, true);
  }

  @HttpCode(200)
  @Post(':id/resume')
  @RequirePermissions('leads.create')
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.setPaused(id, false);
  }

  /**
   * Bulk-delete a batch and every Lead it created. Cascades soft-delete to
   * the linked Lead rows so they vanish from the sales team's lead lists,
   * the admin leads page, and the WhatsApp inbox (queries filter by
   * lead.deletedAt). The batch row itself is also soft-deleted so it drops
   * off this page.
   */
  @Delete(':id')
  @RequirePermissions('leads.delete')
  async deleteBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.service.deleteBatch(id, user.id);
    return { success: true, deletedLeads: result.deletedLeads };
  }
}
