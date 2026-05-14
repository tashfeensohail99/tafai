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
// Public controller — no auth guard — only used for the email verify link
// ---------------------------------------------------------------------------

@Controller('leads')
export class LeadVerificationController {
  constructor(private readonly leadsService: LeadsService) {}

  /**
   * GET /leads/verify-email?token=xxx
   * Called when the lead clicks the verification link in their email.
   * Returns an HTML confirmation page so the lead sees a friendly message.
   */
  @Get('verify-email')
  async confirmEmail(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.leadsService.verifyLeadEmail(token);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildVerifySuccessHtml(result.leadName));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Verification failed. The link may be invalid or expired.';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(buildVerifyErrorHtml(message));
    }
  }
}

function buildVerifySuccessHtml(leadName: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email Verified — Tashfeen</title>
<style>body{margin:0;background:#f4f4f7;font-family:Inter,Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.card{background:#fff;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);}
.icon{font-size:56px;margin-bottom:16px;}.title{font-size:24px;font-weight:700;color:#0f172a;margin:0 0 8px;}
.sub{font-size:14px;color:#64748b;line-height:1.6;}.badge{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;font-size:13px;font-weight:600;padding:6px 14px;border-radius:999px;margin:20px 0;}
.footer{margin-top:32px;font-size:12px;color:#94a3b8;}</style></head>
<body><div class="card">
<div class="icon">✅</div>
<h1 class="title">Email Verified!</h1>
<p class="sub">Hi <strong>${escapeHtml(leadName)}</strong>, your email address has been verified successfully.<br/>Our team will be in touch with you shortly.</p>
<div class="badge">✓ Verified</div>
<p class="footer">Tashfeen Immigration Solutions · tashfeengroup.com</p>
</div></body></html>`;
}

function buildVerifyErrorHtml(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Verification Failed — Tashfeen</title>
<style>body{margin:0;background:#f4f4f7;font-family:Inter,Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.card{background:#fff;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);}
.icon{font-size:56px;margin-bottom:16px;}.title{font-size:24px;font-weight:700;color:#0f172a;margin:0 0 8px;}
.sub{font-size:14px;color:#64748b;line-height:1.6;}.footer{margin-top:32px;font-size:12px;color:#94a3b8;}</style></head>
<body><div class="card">
<div class="icon">❌</div>
<h1 class="title">Verification Failed</h1>
<p class="sub">${escapeHtml(message)}</p>
<p class="sub" style="margin-top:16px;">Please ask a consultant to resend the verification email.</p>
<p class="footer">Tashfeen Immigration Solutions · tashfeengroup.com</p>
</div></body></html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}