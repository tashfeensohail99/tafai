import { Injectable } from '@nestjs/common';
import type { PDFOptions } from 'puppeteer-core';
import { PdfRenderService } from '../pdf/pdf.service';

// Navy-locked Tashfeen logo (the source SVG flips colors under
// prefers-color-scheme:light, which headless Chrome would trigger — so the
// fills are hard-coded to the dark/navy brand here).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420">
<style>.bg{fill:#0b1f3a}.mm{fill:#f8fafc}.ms{fill:#cbd5e1}.ac{fill:#d6a84f}.word{fill:#f8fafc;font-family:Montserrat,Arial,Helvetica,sans-serif;font-weight:800;letter-spacing:3px}.tag{fill:#cbd5e1;font-family:Montserrat,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:4px}</style>
<rect class="bg" x="0" y="0" width="1200" height="420" rx="34"/>
<g transform="translate(72 74)"><path class="ms" d="M0 0h342c-9 29-28 48-59 57H200v247h-48V57H24C13 44 5 25 0 0Z"/><path class="mm" d="M126 57h74l-37 247h-37V57Z"/><path class="ac" d="M154 304h46l-58 42 12-42Z"/></g>
<g transform="translate(440 138)"><text class="word" x="0" y="62" font-size="64">TASHFEEN</text><rect class="ac" x="2" y="92" width="426" height="6" rx="3"/><text class="tag" x="2" y="136" font-size="24">IMMIGRATION SOLUTIONS</text></g>
</svg>`;
const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** Branded running header (logo banner) repeated on every PDF page.
 *  Explicit banner height keeps it compact (Puppeteer otherwise lets it grow
 *  to fill the top margin); the logo is sized to fill the band. */
const HEADER_TEMPLATE = `<div style="width:100%;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="background:#0b1f3a;height:58px;box-sizing:border-box;display:flex;align-items:center;padding:0 42px;"><img src="${LOGO_DATA_URI}" style="height:46px;display:block;"/></div>
  <div style="height:3px;background:#d6a84f;"></div>
</div>`;

/** Branded running footer (contact + page numbers) on every page. */
const FOOTER_TEMPLATE = `<div style="width:100%;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="height:3px;background:#d6a84f;"></div>
  <div style="background:#0b1f3a;color:#e2e8f0;padding:6px 30px 7px;font-size:8px;text-align:center;line-height:1.5;">
    +92 335 000 1111 &nbsp;&middot;&nbsp; info@tashfeenimmigrationsolutions.com &nbsp;&middot;&nbsp; Office no. 3029A, 3029B, 3031, 3032, 3rd Floor, World Trade Center, Giga Mall DHA-2 Islamabad
    <div style="font-size:7px;color:#94a3b8;margin-top:2px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
  </div>
</div>`;

/** A payment-plan row used when composing the Annexure-A table. */
export interface PaymentStage {
  label: string;
  amount?: number | null;
  trigger?: string | null;
  dueDate?: string | null;
}

/** Applicant + agreement fields substituted into a template body. */
export interface AgreementVars {
  AGREEMENT_NUMBER?: string;
  AGREEMENT_DATE?: string;
  PROGRAM_TITLE?: string;
  APPLICANT_NAME?: string;
  FATHER_NAME?: string;
  CNIC?: string;
  PASSPORT?: string;
  DOB?: string;
  NATIONALITY?: string;
  ADDRESS?: string;
  PHONE?: string;
  EMAIL?: string;
  FILE_NUMBER?: string;
  TOTAL_AMOUNT?: string;
  CURRENCY?: string;
}

/** Applicant bio stored on an agreement (decoupled from the DTO layer). */
export interface AgreementBioData {
  applicantName?: string;
  fatherName?: string;
  cnic?: string;
  passport?: string;
  dob?: string;
  nationality?: string;
  address?: string;
  phone?: string;
  email?: string;
  fileNumber?: string;
  agreementDate?: string;
}

/** Structured payment plan stored on an agreement. */
export interface AgreementPlanData {
  planType?: string;
  currency?: string;
  grossAmount?: number;
  discountAmount?: number;
  netPayable?: number;
  taxAmount?: number;
  installments?: Array<{
    sequence?: number;
    stage?: string;
    amount?: number | null;
    trigger?: string | null;
    dueDate?: string | null;
    notes?: string | null;
  }>;
  governmentFees?: Array<{
    label?: string;
    amount?: number;
    currency?: string;
    payableBy?: string;
  }>;
  refundable?: boolean;
  refundPolicyText?: string;
  notes?: string;
}

/**
 * Turns an agreement template (clause HTML with {{TOKENS}} + a
 * {{PAYMENT_PLAN}} slot) plus applicant data + a payment plan into a
 * branded, print-ready A4 PDF via the headless-Chrome engine.
 *
 * Token rules:
 *  - {{PAYMENT_PLAN}} is replaced with a generated HTML table (raw).
 *  - All other {{TOKEN}} values are HTML-escaped before insertion.
 *  - Unknown tokens render as a highlighted [TOKEN] so authors notice.
 */
@Injectable()
export class AgreementRenderService {
  /** The tokens an author may use in a template body. Surfaced in the UI. */
  static readonly SUPPORTED_TOKENS: readonly string[] = [
    'AGREEMENT_NUMBER',
    'AGREEMENT_DATE',
    'PROGRAM_TITLE',
    'APPLICANT_NAME',
    'FATHER_NAME',
    'CNIC',
    'PASSPORT',
    'DOB',
    'NATIONALITY',
    'ADDRESS',
    'PHONE',
    'EMAIL',
    'FILE_NUMBER',
    'TOTAL_AMOUNT',
    'CURRENCY',
    'PAYMENT_PLAN',
  ];

  constructor(private readonly pdf: PdfRenderService) {}

  /** Compose body HTML: inject payment-plan table, then substitute tokens. */
  composeBody(
    bodyHtml: string,
    vars: AgreementVars,
    stages: PaymentStage[],
    currency: string,
  ): string {
    const planHtml = this.renderPaymentPlan(stages, currency);
    let out = bodyHtml.replace(/\{\{\s*PAYMENT_PLAN\s*\}\}/g, planHtml);
    out = out.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
      const value = (vars as Record<string, string | undefined>)[key];
      if (value != null && value !== '') return this.escapeHtml(value);
      return `<span class="token-missing">[${key}]</span>`;
    });
    return out;
  }

  /** Wrap composed body in the branded full HTML document. */
  wrapDocument(programTitle: string, innerHtml: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt;
         line-height: 1.55; color: #1a1d29; margin: 0; padding: 0 16mm; }
  .brand { border-bottom: 2px solid #0d1226; padding-bottom: 10px; margin-bottom: 16px; }
  .brand .name { font-size: 15pt; font-weight: 700; letter-spacing: .5px; color: #0d1226; }
  .brand .tag { font-size: 8.5pt; color: #5a6080; margin-top: 2px; }
  h1.doc-title { font-size: 14pt; text-align: center; margin: 16px 0 14px;
                 text-transform: uppercase; letter-spacing: .5px; }
  h2 { font-size: 12pt; margin: 16px 0 6px; }
  h3 { font-size: 11pt; margin: 13px 0 4px; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 18px; }
  li { margin: 3px 0; }
  table.payplan { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
  table.payplan th, table.payplan td { border: 1px solid #c9cee0; padding: 7px 9px;
                                       text-align: left; vertical-align: top; }
  table.payplan th { background: #0d1226; color: #fff; font-weight: 600; }
  table.payplan tr.total td { font-weight: 700; background: #f1f3f9; }
  .token-missing { background: #fde68a; color: #92400e; padding: 0 3px; border-radius: 2px;
                   font-size: 9.5pt; }
  .sig { margin-top: 36px; display: flex; justify-content: space-between; gap: 48px; }
  .sig .box { flex: 1; }
  .sig .line { border-top: 1px solid #1a1d29; margin-top: 42px; padding-top: 4px;
               font-size: 9pt; color: #5a6080; }
  .page-break { page-break-before: always; }
  table, tr, td, th, .sig { page-break-inside: avoid; }
</style>
</head>
<body>
  <h1 class="doc-title">${this.escapeHtml(programTitle)}</h1>
  ${innerHtml}
</body>
</html>`;
  }

  /**
   * Render a template preview to a PDF buffer using sample applicant data,
   * so an author sees the true layout before saving. Falls back to a sample
   * payment plan when the template defines no default stages.
   */
  async renderTemplatePreviewPdf(
    programTitle: string,
    bodyHtml: string,
    defaultStages?: PaymentStage[],
  ): Promise<Buffer> {
    const currency = 'CAD';
    const vars = this.sampleVars(programTitle);
    const stages =
      defaultStages && defaultStages.length > 0
        ? defaultStages
        : this.sampleStages();
    const inner = this.composeBody(bodyHtml, vars, stages, currency);
    const doc = this.wrapDocument(programTitle, inner);
    return this.pdf.renderHtml(doc, this.agreementPdfOptions());
  }

  // ─── Real agreement composition (from bio + structured plan) ─────────────

  /** Map applicant bio + plan totals to the substitution variables. */
  buildAgreementVars(
    programTitle: string,
    bio: AgreementBioData,
    plan: AgreementPlanData,
    agreementNumber?: string,
  ): AgreementVars {
    const currency = plan.currency ?? 'CAD';
    const net = plan.netPayable ?? 0;
    return {
      AGREEMENT_NUMBER: agreementNumber ?? '',
      AGREEMENT_DATE:
        bio.agreementDate && bio.agreementDate.trim()
          ? bio.agreementDate
          : new Date().toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            }),
      PROGRAM_TITLE: programTitle,
      APPLICANT_NAME: bio.applicantName ?? '',
      FATHER_NAME: bio.fatherName ?? '',
      CNIC: bio.cnic ?? '',
      PASSPORT: bio.passport ?? '',
      DOB: bio.dob ?? '',
      NATIONALITY: bio.nationality ?? '',
      ADDRESS: bio.address ?? '',
      PHONE: bio.phone ?? '',
      EMAIL: bio.email ?? '',
      FILE_NUMBER: bio.fileNumber ?? '',
      TOTAL_AMOUNT: `${currency} ${this.formatMoney(net)}`,
      CURRENCY: currency,
    };
  }

  private planToStages(plan: AgreementPlanData): PaymentStage[] {
    return (plan.installments ?? [])
      .slice()
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((s) => ({
        label: s.stage ?? '',
        amount: s.amount ?? null,
        trigger: s.trigger ?? null,
        dueDate: s.dueDate ?? null,
      }));
  }

  /** Substituted inner HTML for an agreement (stored as contentHtml). */
  composeAgreementInner(
    bodyHtml: string,
    programTitle: string,
    bio: AgreementBioData,
    plan: AgreementPlanData,
    agreementNumber?: string,
  ): string {
    const vars = this.buildAgreementVars(programTitle, bio, plan, agreementNumber);
    const stages = this.planToStages(plan);
    return this.composeBody(bodyHtml, vars, stages, plan.currency ?? 'CAD');
  }

  /** Full branded PDF for a concrete agreement. */
  async renderAgreementPdf(
    programTitle: string,
    bodyHtml: string,
    bio: AgreementBioData,
    plan: AgreementPlanData,
    agreementNumber?: string,
  ): Promise<Buffer> {
    const inner = this.composeAgreementInner(
      bodyHtml,
      programTitle,
      bio,
      plan,
      agreementNumber,
    );
    return this.pdf.renderHtml(
      this.wrapDocument(programTitle, inner),
      this.agreementPdfOptions(),
    );
  }

  /**
   * Render an already-composed inner body — used when Sales has edited the
   * agreement document directly (the stored contentHtml is the source of
   * truth, not the template).
   */
  async renderStoredPdf(programTitle: string, innerHtml: string): Promise<Buffer> {
    return this.pdf.renderHtml(
      this.wrapDocument(programTitle, innerHtml),
      this.agreementPdfOptions(),
    );
  }

  /**
   * PDF options for agreement renders: the branded letterhead (logo header +
   * contact footer) repeats on every page via displayHeaderFooter, with top/
   * bottom margins sized to fit them and full-bleed (left/right = 0) so the
   * banners reach the page edges. The body supplies its own horizontal pad.
   */
  private agreementPdfOptions(): PDFOptions {
    return {
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: '20mm', right: '0', bottom: '20mm', left: '0' },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private renderPaymentPlan(stages: PaymentStage[], currency: string): string {
    if (!stages || stages.length === 0) {
      return '<p><em>Payment plan to be inserted.</em></p>';
    }
    const rows = stages
      .map((s, i) => {
        const amount =
          s.amount != null ? `${currency} ${this.formatMoney(s.amount)}` : '—';
        const when = s.trigger ?? s.dueDate ?? '—';
        return `<tr><td>${i + 1}</td><td>${this.escapeHtml(s.label)}</td><td>${amount}</td><td>${this.escapeHtml(when)}</td></tr>`;
      })
      .join('');
    const total = stages.reduce((sum, s) => sum + (s.amount ?? 0), 0);
    return `<table class="payplan">
  <thead><tr><th>#</th><th>Stage</th><th>Amount</th><th>Trigger / Due</th></tr></thead>
  <tbody>${rows}<tr class="total"><td colspan="2">Total</td><td>${currency} ${this.formatMoney(total)}</td><td></td></tr></tbody>
</table>`;
  }

  private sampleVars(programTitle: string): AgreementVars {
    return {
      AGREEMENT_NUMBER: 'AGR-2026-0001',
      AGREEMENT_DATE: new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
      PROGRAM_TITLE: programTitle,
      APPLICANT_NAME: 'John A. Sample',
      FATHER_NAME: 'Robert Sample',
      CNIC: '00000-0000000-0',
      PASSPORT: 'AB1234567',
      DOB: '01 January 1990',
      NATIONALITY: 'Pakistani',
      ADDRESS: '123 Sample Street, Islamabad, Pakistan',
      PHONE: '+92 300 0000000',
      EMAIL: 'applicant@example.com',
      FILE_NUMBER: 'TIS-0001',
      TOTAL_AMOUNT: 'CAD 10,500',
      CURRENCY: 'CAD',
    };
  }

  private sampleStages(): PaymentStage[] {
    return [
      { label: 'Advance / signing fee', amount: 2000, trigger: 'At signing' },
      { label: 'File preparation', amount: 4000, trigger: 'On file submission' },
      { label: 'Final stage', amount: 4500, trigger: 'On approval' },
    ];
  }

  private formatMoney(amount: number): string {
    if (Number.isNaN(amount)) return String(amount);
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
