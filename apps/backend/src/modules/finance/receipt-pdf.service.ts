import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { StorageService } from '../storage/storage.service';

/**
 * Renders payment receipts as PDF documents using pdfkit and stores the
 * result via StorageService. Chosen for:
 *   - Pure-JS (no Chromium / Playwright runtime overhead)
 *   - Streaming API → no temp files
 *   - Stable output (regenerating the same receipt gives byte-identical PDFs
 *     except timestamps, which matters for legal compliance)
 *
 * Layout target: A4 (210 × 297 mm). Margins 50pt all sides. Tashfeen
 * Immigration Solutions branded header + a clear payment summary grid
 * + invoice context + footer with terms. Plain text, no images, so the
 * PDF renders identically on every viewer without external font/image
 * dependencies.
 */
export interface ReceiptPdfInput {
  receiptNumber: string;
  issuedAt: Date;
  amount: string;
  currency: string;
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
  notes: string | null;
  issuedBy: {
    name: string;
    role: string;
  };
}

@Injectable()
export class ReceiptPdfService {
  private readonly logger = new Logger(ReceiptPdfService.name);

  constructor(private readonly storage: StorageService) {}

  /**
   * Render the receipt to a PDF buffer, upload to storage, return the
   * storage key. Caller is responsible for persisting the key on the
   * Receipt row. Idempotent at the storage level — re-running produces
   * a new key (each generation is a separate artifact), but the
   * Receipt row should be updated so historical links keep working.
   */
  async renderAndStore(input: ReceiptPdfInput): Promise<{
    key: string;
    sizeBytes: number;
  }> {
    const buffer = await this.renderToBuffer(input);
    const upload = await this.storage.upload(
      buffer,
      'application/pdf',
      'finance-receipts',
      `${input.receiptNumber}.pdf`,
    );
    return { key: upload.key, sizeBytes: upload.sizeBytes };
  }

  private renderToBuffer(input: ReceiptPdfInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        this.drawHeader(doc);
        this.drawTitleBlock(doc, input);
        this.drawCustomerBlock(doc, input);
        this.drawPaymentBlock(doc, input);
        this.drawInvoiceContext(doc, input);
        if (input.notes) this.drawNotes(doc, input.notes);
        this.drawFooter(doc, input);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Sections ─────────────────────────────────────────────────────────

  private drawHeader(doc: PDFKit.PDFDocument) {
    // Branded header bar with company name and tagline.
    doc
      .fillColor('#0d1226')
      .rect(50, 50, 495, 70)
      .fill();

    doc
      .fillColor('#ffffff')
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('TASHFEEN IMMIGRATION SOLUTIONS', 65, 65);

    doc
      .fillColor('#b3b9d4')
      .fontSize(10)
      .font('Helvetica')
      .text('Visa & Immigration Services', 65, 92)
      .text('www.tashfeengroup.com', 65, 105);

    // Reset fill colour for the rest of the doc.
    doc.fillColor('#0d1226');
  }

  private drawTitleBlock(doc: PDFKit.PDFDocument, input: ReceiptPdfInput) {
    const y = 140;
    doc
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('PAYMENT RECEIPT', 50, y);

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#5a6080')
      .text(`Receipt no.    ${input.receiptNumber}`, 50, y + 32)
      .text(`Issued on      ${this.formatDate(input.issuedAt)}`, 50, y + 47)
      .text(
        `Customer ref.  ${input.customer.referenceCode}`,
        50,
        y + 62,
      );

    doc.fillColor('#0d1226');
  }

  private drawCustomerBlock(doc: PDFKit.PDFDocument, input: ReceiptPdfInput) {
    const y = 230;
    doc.lineWidth(1).strokeColor('#dadfee').moveTo(50, y).lineTo(545, y).stroke();
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('Received from', 50, y + 12);
    doc
      .fontSize(12)
      .font('Helvetica')
      .fillColor('#0d1226')
      .text(input.customer.fullName, 50, y + 28);

    let line = y + 44;
    doc.fontSize(10).fillColor('#5a6080');
    if (input.customer.phone) {
      doc.text(`Phone:  ${input.customer.phone}`, 50, line);
      line += 14;
    }
    if (input.customer.email) {
      doc.text(`Email:  ${input.customer.email}`, 50, line);
    }
    doc.fillColor('#0d1226');
  }

  private drawPaymentBlock(doc: PDFKit.PDFDocument, input: ReceiptPdfInput) {
    const y = 330;
    doc.lineWidth(1).strokeColor('#dadfee').moveTo(50, y).lineTo(545, y).stroke();
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('Payment received', 50, y + 12);

    // Big amount line — the headline number, in the payment's currency.
    doc
      .fontSize(28)
      .font('Helvetica-Bold')
      .fillColor('#0d1226')
      .text(
        `${input.currency} ${this.formatMoney(input.amount)}`,
        50,
        y + 32,
      );

    // Two-column detail grid below the amount.
    const detailY = y + 78;
    doc.fontSize(10).font('Helvetica').fillColor('#5a6080');
    doc.text('Method:', 50, detailY);
    doc
      .font('Helvetica-Bold')
      .fillColor('#0d1226')
      .text(input.paymentMethod ?? '—', 130, detailY);

    doc
      .font('Helvetica')
      .fillColor('#5a6080')
      .text('Reference:', 320, detailY);
    doc
      .font('Helvetica-Bold')
      .fillColor('#0d1226')
      .text(input.transactionRef ?? '—', 395, detailY);
  }

  private drawInvoiceContext(doc: PDFKit.PDFDocument, input: ReceiptPdfInput) {
    const y = 460;
    doc.lineWidth(1).strokeColor('#dadfee').moveTo(50, y).lineTo(545, y).stroke();
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#0d1226')
      .text('Applied against invoice', 50, y + 12);

    const total = Number(input.invoice.totalAmount);
    const paid = Number(input.invoice.paidAmount);
    const remaining = Math.max(0, total - paid);

    const labelX = 50;
    const valueX = 200;
    let row = y + 32;
    doc.fontSize(10);

    const drawRow = (label: string, value: string, bold = false) => {
      doc.font('Helvetica').fillColor('#5a6080').text(label, labelX, row);
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor('#0d1226')
        .text(value, valueX, row);
      row += 16;
    };
    drawRow('Invoice number', input.invoice.invoiceNumber);
    drawRow(
      'Invoice total',
      `${input.invoice.currency} ${this.formatMoney(input.invoice.totalAmount)}`,
    );
    drawRow(
      'Paid to date',
      `${input.invoice.currency} ${this.formatMoney(input.invoice.paidAmount)}`,
      true,
    );
    drawRow(
      'Balance remaining',
      remaining === 0
        ? 'PAID IN FULL'
        : `${input.invoice.currency} ${this.formatMoney(String(remaining))}`,
      true,
    );
  }

  private drawNotes(doc: PDFKit.PDFDocument, notes: string) {
    const y = 610;
    doc.lineWidth(1).strokeColor('#dadfee').moveTo(50, y).lineTo(545, y).stroke();
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#0d1226')
      .text('Notes', 50, y + 12);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#5a6080')
      .text(notes, 50, y + 30, { width: 495 });
  }

  private drawFooter(doc: PDFKit.PDFDocument, input: ReceiptPdfInput) {
    const y = 740;
    doc.lineWidth(1).strokeColor('#dadfee').moveTo(50, y).lineTo(545, y).stroke();
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#5a6080')
      .text(
        `Issued by ${input.issuedBy.name} (${input.issuedBy.role}) · Tashfeen Immigration Solutions`,
        50,
        y + 10,
        { width: 495, align: 'center' },
      );
    doc
      .fontSize(8)
      .text(
        'This receipt is computer-generated. For verification of authenticity quote the receipt number.',
        50,
        y + 28,
        { width: 495, align: 'center' },
      );
  }

  // ─── Formatters ────────────────────────────────────────────────────────

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

  private formatMoney(amountStr: string): string {
    const n = Number(amountStr);
    if (Number.isNaN(n)) return amountStr;
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
