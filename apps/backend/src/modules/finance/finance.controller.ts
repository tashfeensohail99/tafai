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
import { AuditDocumentAccess } from '../../common/decorators/audit-document-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { FinanceService } from './finance.service';
import { Audit } from '../../common/decorators/audit.decorator';
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
  LockPeriodDto,
  RecognizeInstallmentDto,
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
  @Audit({ entityType: 'Invoice', category: 'EXPORT', severity: 'HIGH', action: 'DATA_EXPORTED' })
  @Get('invoices/export.csv')
  @RequirePermissions('reports.export')
  async exportInvoicesCsv(
    @Query() query: ListInvoicesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    // CSV export needs the full result set — pass a high `take` explicitly so
    // the pagination cap on the list endpoint doesn't silently truncate the
    // download. Bounded at 5000 as a sanity ceiling.
    const rows = (await this.financeService.listInvoices({ ...query, take: 5000 })) as unknown as Array<{
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

  /** Firm-wide finance report: revenue + cost + margin + AR position. */
  @Get('reports/summary')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  getReportsSummary() {
    return this.financeService.getReportsSummary();
  }

  /** Accounts-receivable aging: outstanding invoices bucketed by days overdue. */
  @Get('reports/aging')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  getAgingReport() {
    return this.financeService.getAgingReport();
  }

  /** GST/HST tax report: output tax (invoices) − input tax (expenses), per currency. */
  @Get('reports/tax')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  getTaxReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.financeService.getTaxReport(from, to);
  }

  /** Set/clear the accounting period-lock (book-close) date. Admin only. */
  @Post('reports/lock-period')
  @RequirePermissions('settings.manage')
  lockPeriod(@Body() dto: LockPeriodDto, @CurrentUser() user: RequestUser) {
    return this.financeService.setBooksLockedBefore(dto.date ?? null, user.id);
  }

  /** Live FX rates to CAD (for the currency picker + CAD preview). */
  @Get('fx/rates')
  @RequireAnyPermissions('finance.view_all', 'finance.record_payment', 'finance_handover.create', 'settings.manage')
  getFxRates() {
    return this.financeService.getFxRates();
  }

  /** Issued credit-notes ledger. */
  @Get('credit-notes')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  listCreditNotes(@Query('search') search?: string) {
    return this.financeService.listCreditNotes(search);
  }

  /** Mark/unmark a contract milestone delivered (revenue recognition). */
  @Post('installments/:id/recognize')
  @RequirePermissions('finance.verify_payment')
  recognizeInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecognizeInstallmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.recognizeInstallment(id, dto.recognize ?? true, user.id);
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

  // Sales "hand over" a receipt (finance_handover.create); Finance can also
  // record a payment straight from a customer profile (finance.record_payment)
  // — both land the same FinanceHandover in the verification queue.
  @Post('handovers')
  @RequireAnyPermissions('finance_handover.create', 'finance.record_payment')
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

  /**
   * Get the Receipt issued for a finance handover (via its Payment).
   * Returns null when finance hasn't verified the payment yet — the
   * receipt is issued automatically inside verifyPayment.
   */
  @Get('handovers/:id/receipt')
  @RequirePermissions('finance_handover.view_own')
  async getHandoverReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.findReceiptByHandoverId(id);
  }

  /** Issued-receipts ledger (the Finance "Receipts" screen). */
  @Get('receipts')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  listReceipts(@Query('search') search?: string) {
    return this.financeService.listReceipts(search);
  }

  /**
   * Get a signed download URL for a Receipt PDF. If the stored key is
   * missing (earlier failed render), the service regenerates on the fly
   * before returning the URL.
   */
  @Get('receipts/:id/download')
  @RequireAnyPermissions('finance.view_all', 'finance.record_payment', 'finance_handover.view_own')
  @AuditDocumentAccess('Receipt', 'id')
  async getReceiptDownloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.getReceiptDownloadUrl(id);
  }

  /**
   * Stream the receipt PDF bytes directly (same-origin). Used by the
   * frontend to bypass Supabase Storage's `sandbox` CSP that prevents
   * Chrome's PDF viewer from rendering signed URLs inline.
   *
   * Anyone with finance.view_all / finance.record_payment can view receipts —
   * the old finance_handover.view_own gate is a relic from the retired
   * handover flow and locked super-admin/finance roles out of their own
   * receipts.
   */
  @Get('receipts/:id/pdf')
  @RequireAnyPermissions('finance.view_all', 'finance.record_payment', 'finance_handover.view_own')
  @AuditDocumentAccess('Receipt', 'id')
  async streamReceiptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.financeService.streamReceiptPdf(id, res);
  }

  /** Email the official receipt PDF to the client. */
  @Post('receipts/:id/send')
  @RequireAnyPermissions('finance.record_payment', 'finance.view_all')
  async sendReceiptToClient(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.sendReceiptToClient(id, user.id);
  }
}