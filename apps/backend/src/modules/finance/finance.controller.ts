import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { FinanceService } from './finance.service';
import { rowsToCsv, sendCsvDownload, todayStamp } from '../../common/csv/csv.util';
import {
  AdminDeleteHandoverDto,
  CleanupOrphanHandoversDto,
  CreateFinanceHandoverDto,
  CreateInvoiceDto,
  CreatePaymentDto,
  FinanceHandoverReviewDto,
  ListFinanceHandoversQueryDto,
  ListFinanceQueueQueryDto,
  ListInvoicesQueryDto,
  RefundPaymentDto,
  UpdateFinanceHandoverDto,
  UpdateInvoiceDto,
  VerifyPaymentDto,
} from './finance.dto';

@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('invoices')
  @RequirePermissions('finance.view_all')
  listInvoices(@Query() query: ListInvoicesQueryDto) {
    return this.financeService.listInvoices(query);
  }

  /**
   * CSV export of every invoice that matches the same filter set as
   * GET /finance/invoices. Useful for the admin Finance page and for
   * monthly book closings.
   */
  @Get('invoices/export.csv')
  @RequirePermissions('reports.export')
  async exportInvoicesCsv(
    @Query() query: ListInvoicesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    // Prisma's full row type leaks the relations; for CSV we only need a few
    // fields, so cast through unknown and narrow to what rowsToCsv needs.
    const rows = (await this.financeService.listInvoices(query)) as unknown as Array<{
      id: string;
      invoiceNumber: string;
      status: string;
      currency: string;
      totalAmount: { toString(): string } | number | string;
      paidAmount: { toString(): string } | number | string;
      createdAt: Date;
      dueDate: Date | null;
      lead?: { firstName: string; lastName: string; phone: string } | null;
      client?: { firstName: string; lastName: string; phone: string } | null;
    }>;
    const csv = rowsToCsv(rows, [
      { header: 'Invoice #', value: (r) => r.invoiceNumber },
      { header: 'Status', value: (r) => r.status },
      { header: 'Currency', value: (r) => r.currency },
      { header: 'Total', value: (r) => String(r.totalAmount) },
      { header: 'Paid', value: (r) => String(r.paidAmount) },
      { header: 'Issued', value: (r) => r.createdAt },
      { header: 'Due', value: (r) => r.dueDate },
      {
        header: 'Customer',
        value: (r) => {
          const c = r.client ?? r.lead;
          return c ? `${c.firstName} ${c.lastName}`.trim() : null;
        },
      },
      { header: 'Customer phone', value: (r) => r.client?.phone ?? r.lead?.phone ?? null },
    ]);
    sendCsvDownload(res, `invoices-${todayStamp()}.csv`, csv);
  }

  @Get('invoices/:id')
  @RequirePermissions('finance.view_all')
  findInvoiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.findInvoiceById(id);
  }

  @Get('queue')
  @RequirePermissions('finance.view_all')
  getQueue(@Query() query: ListFinanceQueueQueryDto) {
    return this.financeService.getQueue(query);
  }

  /**
   * Module-wise revenue rollup — totals verified payments grouped by the
   * service the lead/client was on, plus an "all-time" total. Reads from
   * the same Payment rows the queue uses, so numbers always agree.
   */
  @Get('revenue/by-service')
  @RequirePermissions('finance.view_all')
  getRevenueByService() {
    return this.financeService.getRevenueByService();
  }

  @Get('handovers')
  @RequireAnyPermissions('finance_handover.view_all', 'finance_handover.view_own')
  listHandovers(@Query() query: ListFinanceHandoversQueryDto, @CurrentUser() user: RequestUser) {
    return this.financeService.listHandovers(query, user);
  }

  @Get('handovers/:id')
  @RequireAnyPermissions('finance_handover.view_all', 'finance_handover.view_own')
  findHandoverById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.financeService.findHandoverByIdAccessible(id, user);
  }

  @Post('invoices')
  @RequirePermissions('finance.create_invoice')
  createInvoice(@Body() dto: CreateInvoiceDto, @CurrentUser() user: RequestUser) {
    return this.financeService.createInvoice(dto, user.id);
  }

  @Patch('invoices/:id')
  @RequirePermissions('finance.create_invoice')
  updateInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.updateInvoice(id, dto, user.id);
  }

  @Post('payments')
  @RequirePermissions('finance.record_payment')
  recordPayment(@Body() dto: CreatePaymentDto, @CurrentUser() user: RequestUser) {
    return this.financeService.recordPayment(dto, user.id);
  }

  @Post('handovers')
  @RequirePermissions('finance_handover.create')
  createHandover(@Body() dto: CreateFinanceHandoverDto, @CurrentUser() user: RequestUser) {
    return this.financeService.createHandover(dto, user);
  }

  @Patch('handovers/:id')
  @RequirePermissions('finance_handover.update_own')
  updateHandover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinanceHandoverDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.updateHandover(id, dto, user);
  }

  @Post('handovers/:id/review')
  @RequirePermissions('finance_handover.review')
  reviewHandover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinanceHandoverReviewDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.reviewHandover(id, dto, user.id);
  }

  @Post('payments/:id/verify')
  @RequirePermissions('finance.verify_payment')
  verifyPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.verifyPayment(id, dto, user.id);
  }

  @Post('payments/:id/refund')
  @RequirePermissions('finance.refund')
  refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.refundPayment(id, dto, user.id);
  }

  /**
   * Admin maintenance — retroactively void Invoice/Payment rows that
   * were created during a "Verify payment" step but then the handover
   * was rejected, leaving the rows orphaned. Newer code voids these
   * automatically at REJECT time, so this endpoint is meant to be run
   * once against pre-fix data, not on a schedule.
   *
   * Gated by `settings.manage` — same permission level as the other
   * admin-only settings pages (countries, services, integrations).
   * The required `reason` lands on each voided row's notes + the
   * audit log + the lead activity timeline so the cleanup leaves a
   * complete audit trail.
   */
  @Post('maintenance/cleanup-orphans')
  @RequirePermissions('settings.manage')
  cleanupOrphans(
    @Body() dto: CleanupOrphanHandoversDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.cleanupOrphanHandovers(dto.reason, user.id);
  }

  /**
   * Step-up authentication delete: any finance user can INITIATE the
   * deletion (anyone with finance_handover.view_own can reach the
   * page) — the admin's email + password in the body are the actual
   * authorisation gate. The service re-verifies the admin credentials
   * server-side against UserAccount.passwordHash and only proceeds if
   * the matched account is ACTIVE and holds an admin/super_admin role.
   *
   * Both identities (the initiator from JWT, the admin from the body)
   * land on the audit log + the lead timeline so the trail reads
   * "finance officer A deleted this, authorised by admin B".
   */
  @Post('handovers/:id/admin-delete')
  @RequirePermissions('finance_handover.view_own')
  adminDeleteHandover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDeleteHandoverDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.adminDeleteHandover(id, dto, user.id);
  }
}