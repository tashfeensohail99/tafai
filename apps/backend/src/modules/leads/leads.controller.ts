import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AssignLeadDto, ConvertLeadDto, CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';
import { LeadsService } from './leads.service';
import { rowsToCsv, sendCsvDownload, todayStamp } from '../../common/csv/csv.util';

@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned')
  findAll(
    @Query() query: ListLeadsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.findAllAccessible(query, user);
  }

  /**
   * Stream a CSV of every lead the caller can see. Uses the same filtering as
   * GET / so admins get everything and agents get their own book.
   */
  @Get('export.csv')
  @RequirePermissions('reports.export')
  async exportCsv(
    @Query() query: ListLeadsQueryDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.leadsService.findAllAccessible(query, user);
    const csv = rowsToCsv(rows as Array<Record<string, unknown> & {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string;
      status: string;
      serviceInterest: string | null;
      targetCountry: string | null;
      sourceChannel: string | null;
      assignedEmployee?: { firstName: string; lastName: string } | null;
      branch?: { name: string } | null;
      createdAt: Date;
      convertedAt: Date | null;
    }>, [
      { header: 'Lead ID', value: (r) => r.id },
      { header: 'First name', value: (r) => r.firstName },
      { header: 'Last name', value: (r) => r.lastName },
      { header: 'Email', value: (r) => r.email },
      { header: 'Phone', value: (r) => r.phone },
      { header: 'Status', value: (r) => r.status },
      { header: 'Service', value: (r) => r.serviceInterest },
      { header: 'Target country', value: (r) => r.targetCountry },
      { header: 'Source', value: (r) => r.sourceChannel },
      {
        header: 'Assigned to',
        value: (r) =>
          r.assignedEmployee
            ? `${r.assignedEmployee.firstName} ${r.assignedEmployee.lastName}`.trim()
            : null,
      },
      { header: 'Branch', value: (r) => r.branch?.name ?? null },
      { header: 'Created at', value: (r) => r.createdAt },
      { header: 'Converted at', value: (r) => r.convertedAt },
    ]);
    sendCsvDownload(res, `leads-${todayStamp()}.csv`, csv);
  }

  @Get(':id')
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.findByIdAccessible(id, user);
  }

  @Post()
  @RequirePermissions('leads.create')
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: RequestUser) {
    return this.leadsService.create(dto, user.id);
  }

  @Post(':id/assign')
  @RequirePermissions('leads.assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.assign(id, dto, user.id);
  }

  @Post(':id/convert')
  @RequirePermissions('leads.convert')
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.convertToClient(id, user.id, dto.notes);
  }

  @Patch(':id')
  @RequirePermissions('leads.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.update(id, dto, user.id);
  }

  /**
   * Soft-delete a lead. The row stays in the DB but `deletedAt` is set,
   * which removes it from every list / search / detail view (all queries
   * filter `deletedAt: null`). Permission gated to `leads.delete` so only
   * admin / super-admin roles can fire it.
   */
  @Delete(':id')
  @RequirePermissions('leads.delete')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.leadsService.remove(id, user.id);
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Lead file attachments
  // ---------------------------------------------------------------------------

  @Post(':id/files')
  @RequirePermissions('leads.update')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
    }),
  )
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new Error('No file provided. Use multipart/form-data with field name "file".');
    }
    return this.leadsService.uploadLeadFile(id, file, user);
  }

  @Get(':id/files')
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned')
  listFiles(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.listLeadFiles(id, user);
  }

  @Get(':id/files/:fileId/url')
  @RequireAnyPermissions('leads.view_all', 'leads.view_assigned')
  getFileUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.getLeadFileSignedUrl(id, fileId, user);
  }

  @Delete(':id/files/:fileId')
  @RequirePermissions('leads.update')
  deleteFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.deleteLeadFile(id, fileId, user);
  }

  // ---------------------------------------------------------------------------
  // Email verification (send)
  // ---------------------------------------------------------------------------

  @Post(':id/send-email-verification')
  @RequireAnyPermissions('leads.update', 'leads.view_assigned', 'leads.view_all')
  sendEmailVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leadsService.sendEmailVerification(id, user.id);
  }
}

// ---------------------------------------------------------------------------
// Public controller — no auth guard — called by the /verify-lead-email
// frontend page when the lead clicks the verification link in their email.
//
// Mounted at /public/leads (not /leads) on purpose — sharing /leads with the
// authenticated LeadsController caused `verify-email` requests to match the
// `:id` parameter route first and hit the JWT guard.
// ---------------------------------------------------------------------------

@Controller('public/leads')
export class LeadVerificationController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('verify-email')
  async confirmEmail(@Query('token') token: string) {
    return this.leadsService.verifyLeadEmail(token);
  }
}