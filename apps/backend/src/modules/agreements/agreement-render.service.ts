import { Injectable } from '@nestjs/common';
import type { PDFOptions } from 'puppeteer-core';
import { PdfRenderService } from '../pdf/pdf.service';
import { brandedPdfOptions } from '../pdf/branding';

/**
 * Demonym/adjective forms for the destination-country rewrite ("Canadian
 * immigration authorities" → "Australian immigration authorities"). Keys are
 * lowercase country names; anything unmapped falls back to the country name
 * used attributively ("Portugal immigration authorities").
 */
const COUNTRY_ADJECTIVES: Record<string, string> = {
  canada: 'Canadian',
  australia: 'Australian',
  'united kingdom': 'UK',
  uk: 'UK',
  'united states': 'US',
  usa: 'US',
  'new zealand': 'New Zealand',
  portugal: 'Portuguese',
  germany: 'German',
  italy: 'Italian',
  spain: 'Spanish',
  greece: 'Greek',
  malta: 'Maltese',
  hungary: 'Hungarian',
  poland: 'Polish',
  romania: 'Romanian',
  turkey: 'Turkish',
  ireland: 'Irish',
  france: 'French',
  netherlands: 'Dutch',
  norway: 'Norwegian',
  sweden: 'Swedish',
  denmark: 'Danish',
  finland: 'Finnish',
  austria: 'Austrian',
  belgium: 'Belgian',
  switzerland: 'Swiss',
  'czech republic': 'Czech',
  czechia: 'Czech',
  slovakia: 'Slovak',
  slovenia: 'Slovenian',
  croatia: 'Croatian',
  lithuania: 'Lithuanian',
  latvia: 'Latvian',
  estonia: 'Estonian',
  luxembourg: 'Luxembourg',
  cyprus: 'Cypriot',
  bulgaria: 'Bulgarian',
  albania: 'Albanian',
  serbia: 'Serbian',
  'united arab emirates': 'UAE',
  uae: 'UAE',
  'saudi arabia': 'Saudi',
  qatar: 'Qatari',
  oman: 'Omani',
  kuwait: 'Kuwaiti',
  bahrain: 'Bahraini',
  japan: 'Japanese',
  'south korea': 'South Korean',
  china: 'Chinese',
  singapore: 'Singaporean',
  malaysia: 'Malaysian',
  thailand: 'Thai',
  azerbaijan: 'Azerbaijani',
  georgia: 'Georgian',
  'south africa': 'South African',
  brazil: 'Brazilian',
};

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
  COUNTRY?: string;
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
  /** Destination country of interest — drives {{COUNTRY}} and the
   *  Canada/Canadian rewrite across the whole document. */
  country?: string;
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
    'COUNTRY',
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
    // The country rewrite runs on AUTHORED text only (template prose +
    // plan-stage labels), before token substitution — applicant-entered
    // values (a Canadian nationality, an address in Canada) never change.
    const planHtml = this.applyCountry(
      this.renderPaymentPlan(stages, currency),
      vars.COUNTRY,
    );
    let out = this.applyCountry(bodyHtml, vars.COUNTRY).replace(
      /\{\{\s*PAYMENT_PLAN\s*\}\}/g,
      planHtml,
    );
    out = out.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
      const value = (vars as Record<string, string | undefined>)[key];
      if (value != null && value !== '') return this.escapeHtml(value);
      return `<span class="token-missing">[${key}]</span>`;
    });
    return out;
  }

  /** Parsed destination-country terms; null when no country is known. */
  private countryTerms(
    country?: string,
  ): { name: string; adjective: string; isCanada: boolean } | null {
    const c = country?.trim();
    if (!c) return null;
    return {
      name: c,
      adjective: COUNTRY_ADJECTIVES[c.toLowerCase()] ?? c,
      isCanada: c.toLowerCase() === 'canada',
    };
  }

  /**
   * Make the selected destination country appear EVERYWHERE in authored HTML:
   *  1. Canada-authored templates — rewrite the literal mentions
   *     ("Canada" → country, "Canadian" → its adjective).
   *  2. Templates that name no country at all (generic "the Embassy" /
   *     "the relevant Embassy") — inject the destination's adjective, so a
   *     Norway visit visa reads "the Norwegian Embassy".
   */
  private applyCountry(html: string, country?: string): string {
    const t = this.countryTerms(country);
    if (!t) return html;
    let out = html;
    if (!t.isCanada) {
      out = out
        .replace(/\bCanadian\b/g, this.escapeHtml(t.adjective))
        .replace(/\bCanada\b/g, this.escapeHtml(t.name));
    }
    // "(?! of )" keeps "the Embassy of X" intact — only bare mentions gain
    // the adjective, and already-qualified ones can't double up.
    const adj = this.escapeHtml(t.adjective);
    out = out.replace(
      /\b(the|The) (relevant |Relevant )?Embassy\b(?! of )/g,
      (_m, the: string, rel: string | undefined) =>
        `${the} ${rel ?? ''}${adj} Embassy`,
    );
    // "the Client's visa application" → "...visa application for Norway".
    // Skips ones already qualified ("for X") or mid-flow ("application to
    // the Embassy", where the Embassy injection names the country instead).
    out = out.replace(
      /\bvisa application\b(?! (for|to)\b)/g,
      `visa application for ${this.escapeHtml(t.name)}`,
    );
    // "determined by governmental authorities" → "by Norwegian governmental
    // authorities". Anchored on the article so an already-adjectivised
    // mention ("by Australian governmental authorities") can't double up.
    out = out.replace(
      /\b(by|the) governmental authorit(y|ies)\b/g,
      (_m, lead: string, tail: string) =>
        `${lead} ${adj} governmental authorit${tail}`,
    );
    return out;
  }

  /** Plain-text Canada→country rewrite — for titles / token values. */
  applyCountryText(text: string, country?: string): string {
    const t = this.countryTerms(country);
    if (!t || t.isCanada) return text;
    return text
      .replace(/\bCanadian\b/g, t.adjective)
      .replace(/\bCanada\b/g, t.name);
  }

  /**
   * Title with the destination guaranteed present: rewrite first; if the
   * country still doesn't appear (generic titles like "Visit Visa"), prefix
   * it — "Norway — Temporary Resident Visa – Visit Visa".
   */
  applyCountryTitle(title: string, country?: string): string {
    const t = this.countryTerms(country);
    if (!t) return title;
    const out = this.applyCountryText(title, country);
    const low = out.toLowerCase();
    if (
      low.includes(t.name.toLowerCase()) ||
      low.includes(t.adjective.toLowerCase())
    ) {
      return out;
    }
    return `${t.name} — ${out}`;
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
      // Rewrite-only (no country prefix): the token may sit mid-sentence
      // ("the Client's {{PROGRAM_TITLE}} application to ..."), where a
      // prefixed title reads badly. The big document heading gets the
      // guaranteed-present treatment via applyCountryTitle at wrap time.
      PROGRAM_TITLE: this.applyCountryText(programTitle, bio.country),
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
      COUNTRY: bio.country?.trim() || 'Canada',
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
      this.wrapDocument(this.applyCountryTitle(programTitle, bio.country), inner),
      this.agreementPdfOptions(),
    );
  }

  /**
   * Render an already-composed inner body — used when Sales has edited the
   * agreement document directly (the stored contentHtml is the source of
   * truth, not the template). The destination country still rewrites the
   * document title, which comes from the (Canada-authored) template.
   */
  async renderStoredPdf(
    programTitle: string,
    innerHtml: string,
    country?: string,
  ): Promise<Buffer> {
    return this.pdf.renderHtml(
      this.wrapDocument(this.applyCountryTitle(programTitle, country), innerHtml),
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
    return brandedPdfOptions();
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
      COUNTRY: 'Canada',
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
