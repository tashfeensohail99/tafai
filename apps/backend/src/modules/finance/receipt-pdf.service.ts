import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PdfRenderService } from '../pdf/pdf.service';
import { brandedPdfOptions } from '../pdf/branding';

/**
 * Renders payment receipts as branded A4 PDFs through the shared headless-Chrome
 * engine, so the receipt carries the SAME letterhead as agreements — the
 * Tashfeen logo banner header and the contact/address footer (see pdf/branding).
 *
 * The body shows: receipt number, date, client ID, client name, the payment
 * received (in the original currency it was received in, e.g. PKR, with the CAD
 * equivalent), the invoice it was applied against, and the balance remaining.
 */
export interface ReceiptPdfInput {
  receiptNumber: string;
  issuedAt: Date;
  amount: string;
  currency: string;
  /** CAD equivalent + rate, when the payment was received in a foreign currency. */
  baseAmount?: string | null;
  baseCurrency?: string | null;
  fxRate?: string | null;
  paymentMethod: string | null;
  transactionRef: string | null;
  customer: {
    referenceCode: string;
    fullName: string;
    phone: string | null;
    email: string | null;
  };
  invoice: {
    invoiceNumber: string;
    totalAmount: string;
    paidAmount: string;
    currency: string;
  };
  /**
   * Engagement-level account view (whole agreement / contract). When present
   * the receipt shows the full client balance instead of just this invoice —
   * so the client sees total fee, paid to date across all installments, and
   * what's still owed. Falls back to the per-invoice figures if omitted.
   */
  account?: {
    totalFee: number;
    totalPaid: number;
    remaining: number;
    installmentsPaid: number;
    installmentsTotal: number;
    currency: string;
  };
  /** Unpaid / upcoming installments so the client sees what's still due and when. */
  upcomingInstallments?: Array<{
    sequence: number;
    description: string | null;
    dueDate: Date | null;
    amount: number;
    status: 'PENDING' | 'PARTIALLY_PAID';
  }>;
  notes: string | null;
  issuedBy: {
    name: string;
    role: string;
  };
}

@Injectable()
export class ReceiptPdfService {
  private readonly logger = new Logger(ReceiptPdfService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly pdf: PdfRenderService,
  ) {}

  /**
   * Render the receipt to a PDF buffer, upload to storage, return the key.
   * Caller persists the key on the Receipt row.
   */
  async renderAndStore(input: ReceiptPdfInput): Promise<{ key: string; sizeBytes: number }> {
    const html = this.buildHtml(input);
    const buffer = await this.pdf.renderHtml(html, brandedPdfOptions());
    const upload = await this.storage.upload(
      buffer,
      'application/pdf',
      'finance-receipts',
      `${input.receiptNumber}.pdf`,
    );
    return { key: upload.key, sizeBytes: upload.sizeBytes };
  }

  private buildHtml(input: ReceiptPdfInput): string {
    // Prefer the engagement view (total fee / total paid across all
    // installments / remaining balance). Fall back to this invoice's
    // figures only when we have no wider context (one-off invoice, no
    // service contract behind it).
    const account = input.account ?? {
      totalFee: Number(input.invoice.totalAmount),
      totalPaid: Number(input.invoice.paidAmount),
      remaining: Math.max(0, Number(input.invoice.totalAmount) - Number(input.invoice.paidAmount)),
      installmentsPaid: 0,
      installmentsTotal: 0,
      currency: input.invoice.currency,
    };
    const fullyPaid = account.remaining < 0.005;
    const upcoming = input.upcomingInstallments ?? [];

    // Strip the internal "Created from finance handover <uuid>" annotation —
    // it's an audit breadcrumb for our team, never something a client should
    // see on their official receipt.
    const cleanNotes = (input.notes ?? '')
      .replace(/Created from finance handover\s+[^\s]+\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // The big headline amount is what the client actually paid, in the currency
    // they paid in. When that's not CAD, show the CAD equivalent beneath.
    const paidLine = `${this.esc(input.currency)} ${this.money(input.amount)}`;
    const showBase =
      input.baseAmount != null &&
      input.baseCurrency != null &&
      input.baseCurrency !== input.currency;
    const baseLine = showBase
      ? `≈ ${this.esc(input.baseCurrency!)} ${this.money(input.baseAmount!)}${
          input.fxRate ? ` &nbsp;·&nbsp; 1 ${this.esc(input.baseCurrency!)} = ${this.money(input.fxRate)} ${this.esc(input.currency)}` : ''
        }`
      : '';

    const detailRow = (label: string, value: string, strong = false) => `
      <tr>
        <td style="padding:5px 0;color:#64748b;font-size:11px;">${label}</td>
        <td style="padding:5px 0;text-align:right;color:#0f172a;font-size:11px;${strong ? 'font-weight:700;' : ''}">${value}</td>
      </tr>`;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;margin:0;padding:4mm 16mm 0;font-size:12px;}
  .title{font-size:22px;font-weight:800;letter-spacing:.5px;color:#0b1f3a;margin:4px 0 2px;}
  .sub{font-size:11px;color:#64748b;margin:0 0 14px;}
  .meta{width:100%;border-collapse:collapse;margin:0 0 18px;}
  .meta td{padding:3px 0;font-size:11px;}
  .meta .k{color:#64748b;width:120px;}
  .meta .v{color:#0f172a;font-weight:600;}
  .section{border-top:1px solid #e2e8f0;padding-top:10px;margin-top:6px;}
  .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:4px;}
  .amount{font-size:30px;font-weight:800;color:#0b1f3a;line-height:1.1;}
  .amount-base{font-size:12px;color:#64748b;margin-top:3px;}
  .grid{display:flex;gap:24px;margin-top:10px;}
  .grid .col{flex:1;}
  .inv{width:100%;border-collapse:collapse;margin-top:6px;}
  .up{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px;}
  .up th{text-align:left;padding:6px 8px;background:#f1f5f9;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;}
  .up td{padding:6px 8px;color:#0f172a;border-bottom:1px solid #f1f5f9;}
  .balance{margin-top:12px;background:${fullyPaid ? '#ecfdf5' : '#fff7ed'};border:1px solid ${fullyPaid ? '#a7f3d0' : '#fed7aa'};
           border-radius:8px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;}
  .balance .bl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;}
  .balance .bv{font-size:18px;font-weight:800;color:${fullyPaid ? '#047857' : '#b45309'};}
  .notes{margin-top:14px;font-size:11px;color:#475569;}
  .issued{margin-top:18px;font-size:9.5px;color:#94a3b8;text-align:center;line-height:1.6;}
  .stamp{display:inline-block;margin-top:8px;border:2px solid ${fullyPaid ? '#047857' : '#0b1f3a'};color:${fullyPaid ? '#047857' : '#0b1f3a'};
         border-radius:6px;padding:4px 10px;font-size:11px;font-weight:800;letter-spacing:1px;transform:rotate(-3deg);}
</style></head>
<body>
  <div class="title">PAYMENT RECEIPT</div>
  <div class="sub">Official acknowledgement of payment received — Tashfeen Immigration Solutions</div>

  <table class="meta">
    <tr><td class="k">Receipt no.</td><td class="v">${this.esc(input.receiptNumber)}</td>
        <td class="k" style="text-align:right;">Date</td><td class="v" style="text-align:right;">${this.esc(this.formatDate(input.issuedAt))}</td></tr>
    <tr><td class="k">Client ID</td><td class="v">${this.esc(input.customer.referenceCode)}</td>
        <td class="k" style="text-align:right;">Invoice</td><td class="v" style="text-align:right;">${this.esc(input.invoice.invoiceNumber)}</td></tr>
  </table>

  <div class="section">
    <div class="label">Received from</div>
    <div style="font-size:15px;font-weight:700;color:#0f172a;">${this.esc(input.customer.fullName)}</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px;">
      ${input.customer.phone ? `Phone: ${this.esc(input.customer.phone)}` : ''}
      ${input.customer.phone && input.customer.email ? ' &nbsp;·&nbsp; ' : ''}
      ${input.customer.email ? `Email: ${this.esc(input.customer.email)}` : ''}
    </div>
  </div>

  <div class="grid">
    <div class="col section">
      <div class="label">Payment received</div>
      <div class="amount">${paidLine}</div>
      ${baseLine ? `<div class="amount-base">${baseLine}</div>` : ''}
      <span class="stamp">${fullyPaid ? 'PAID IN FULL' : 'RECEIVED WITH THANKS'}</span>
    </div>
    <div class="col section">
      <div class="label">Payment details</div>
      <table class="inv">
        ${detailRow('Method', this.esc(input.paymentMethod ?? '—'))}
        ${detailRow('Reference', this.esc(input.transactionRef ?? '—'))}
      </table>
    </div>
  </div>

  <div class="section">
    <div class="label">Your account (${this.esc(account.currency)})</div>
    <table class="inv">
      ${detailRow('Total agreement fee', `${this.esc(account.currency)} ${this.money(String(account.totalFee))}`)}
      ${detailRow('Paid to date (all payments)', `${this.esc(account.currency)} ${this.money(String(account.totalPaid))}`, true)}
      ${account.installmentsTotal > 0 ? detailRow('Installments paid', `${account.installmentsPaid} of ${account.installmentsTotal}`) : ''}
    </table>
    <div class="balance">
      <div class="bl">Balance remaining</div>
      <div class="bv">${fullyPaid ? 'NIL — PAID IN FULL' : `${this.esc(account.currency)} ${this.money(String(account.remaining))}`}</div>
    </div>
  </div>

  ${upcoming.length > 0 ? `
  <div class="section">
    <div class="label">Upcoming payments</div>
    <table class="up">
      <thead>
        <tr><th>#</th><th>Stage</th><th>Due</th><th style="text-align:right;">Amount</th></tr>
      </thead>
      <tbody>
        ${upcoming
          .map(
            (i) => `<tr>
            <td>${i.sequence}</td>
            <td>${this.esc(i.description ?? '—')}</td>
            <td>${i.dueDate ? this.esc(this.formatDateShort(i.dueDate)) : '—'}</td>
            <td style="text-align:right;font-weight:600;">${this.esc(account.currency)} ${this.money(String(i.amount))}${
              i.status === 'PARTIALLY_PAID'
                ? ' <span style="color:#b45309;font-weight:500;font-size:10px;">(partial)</span>'
                : ''
            }</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${cleanNotes ? `<div class="notes"><strong>Notes:</strong> ${this.esc(cleanNotes)}</div>` : ''}

  <div class="issued">
    Issued by ${this.esc(input.issuedBy.name)} (${this.esc(input.issuedBy.role)}).
    This is a computer-generated receipt — quote the receipt number above to verify its authenticity.
  </div>
</body></html>`;
  }

  private formatDate(date: Date): string {
    return date.toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private formatDateShort(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  }

  private money(amountStr: string): string {
    const n = Number(amountStr);
    if (Number.isNaN(n)) return amountStr;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
