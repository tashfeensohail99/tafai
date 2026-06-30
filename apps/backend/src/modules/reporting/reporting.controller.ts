import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { WhatsAppReportService, type ReportPeriod } from './whatsapp-report.service';

/**
 * Admin "WhatsApp report" panel — Daily / Weekly / Monthly views of who texted
 * the team and how many got a human reply. Same aggregation the 8 AM email uses,
 * so the page and the email always agree.
 */
@Controller('admin/whatsapp-report')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReportingController {
  constructor(private readonly reports: WhatsAppReportService) {}

  // Sales-admin only. Deliberately NOT 'reports.view' — that is held by
  // finance/processing managers and marketing, and this payload exposes every
  // rep's customer names + phone numbers in the awaiting list.
  @Get()
  @RequireAnyPermissions('leads.view_all', 'settings.manage')
  async whatsappReport(@Query('period') period?: string) {
    const p: ReportPeriod = period === 'weekly' || period === 'monthly' ? period : 'daily';
    const { from, to, label } = this.reports.windowFor(p);
    const report = await this.reports.computeActivity(from, to);
    return { period: p, label, ...report };
  }
}
