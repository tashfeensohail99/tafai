'use client';

import { apiFetch, buildQuery } from './api-client';

// ---- Types --------------------------------------------------------------

export interface PaymentStage {
  label: string;
  amount?: number | null;
  trigger?: string | null;
}

export interface AgreementTemplate {
  id: string;
  categoryKey: string;
  name: string;
  programTitle: string;
  bodyHtml: string;
  defaultStages: PaymentStage[] | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  categoryKey: string;
  name: string;
  programTitle: string;
  bodyHtml: string;
  defaultStages?: PaymentStage[];
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdateTemplateInput = Partial<Omit<CreateTemplateInput, 'categoryKey'>>;

// ---- Template CRUD ------------------------------------------------------

export function listAgreementTemplates(
  includeInactive = false,
): Promise<AgreementTemplate[]> {
  return apiFetch<AgreementTemplate[]>(
    `/agreements/templates${includeInactive ? '?includeInactive=true' : ''}`,
  );
}

export function getAgreementTemplate(id: string): Promise<AgreementTemplate> {
  return apiFetch<AgreementTemplate>(`/agreements/templates/${id}`);
}

export function createAgreementTemplate(
  input: CreateTemplateInput,
): Promise<AgreementTemplate> {
  return apiFetch<AgreementTemplate>('/agreements/templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAgreementTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<AgreementTemplate> {
  return apiFetch<AgreementTemplate>(`/agreements/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getAgreementTokens(): Promise<{ tokens: string[] }> {
  return apiFetch<{ tokens: string[] }>('/agreements/templates/tokens');
}

/**
 * Render the current editor content to a preview PDF. The backend returns
 * base64 (auth handled by the JWT fetch); we decode it to a Blob the caller
 * can open in a new tab — no storage round-trip.
 */
export async function previewAgreementTemplatePdf(input: {
  programTitle: string;
  bodyHtml: string;
  defaultStages?: PaymentStage[];
}): Promise<Blob> {
  const res = await apiFetch<{ bytes: number; pdfBase64: string }>(
    '/agreements/templates/preview',
    { method: 'POST', body: JSON.stringify(input), cache: 'no-store' },
  );
  return base64ToPdfBlob(res.pdfBase64);
}

// ---- Agreements (Sales authoring) ---------------------------------------

export type AgreementStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'FINANCE_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'EDITED_PENDING_SALES'
  | 'SENT'
  | 'SIGNED'
  | 'CANCELLED';

export type PaymentPlanType = 'FULL' | 'INSTALLMENT' | 'MILESTONE';

export const AGREEMENT_CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'PKR'] as const;

export interface PaymentInstallmentInput {
  sequence: number;
  stage: string;
  amount: number;
  trigger?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export interface GovernmentFeeInput {
  label: string;
  amount: number;
  currency?: string;
  payableBy?: string | null;
}

export interface PaymentPlanInput {
  planType: PaymentPlanType;
  currency: string;
  grossAmount: number;
  discountAmount: number;
  netPayable: number;
  taxAmount?: number | null;
  installments: PaymentInstallmentInput[];
  governmentFees?: GovernmentFeeInput[];
  refundable?: boolean | null;
  refundPolicyText?: string | null;
  notes?: string | null;
}

export interface BioDataInput {
  applicantName: string;
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
  /** Destination country — rewrites the template's Canada wording everywhere. */
  country?: string;
}

export interface TemplateOption {
  id: string;
  categoryKey: string;
  name: string;
  programTitle: string;
}

export interface AgreementSummary {
  id: string;
  agreementNumber: string;
  categoryKey: string;
  status: AgreementStatus;
  currency: string;
  totalAmount: string;
  grossAmount: string;
  discountAmount: string;
  paymentPlanType: PaymentPlanType | null;
  leadId: string;
  clientId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  /** Set when Finance bounced it back — present on a re-submission. */
  financeNotes?: string | null;
  /** The lead this agreement belongs to — for the Applicant + Ref columns. */
  lead?: { firstName: string; lastName: string; referenceCode: string } | null;
}

export interface AgreementEvent {
  id: string;
  type: string;
  summary: string;
  actorUserId: string | null;
  createdAt: string;
}

/** A rep-raised correction request against a finalised agreement. */
export interface AgreementChangeRequestSummary {
  id: string;
  type: 'BIO' | 'PAYMENT_PLAN';
  status: 'PENDING' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
  requestedByUserId: string;
  createdAt: string;
  appliedAt: string | null;
  rejectedAt: string | null;
  reviewNote: string | null;
}

export interface AgreementDetail extends AgreementSummary {
  templateId: string;
  bioData: BioDataInput;
  paymentPlan: PaymentPlanInput | Record<string, never>;
  contentHtml: string;
  salesNotes: string | null;
  financeNotes: string | null;
  paymentPlanLockedAt: string | null;
  template: { id: string; name: string; categoryKey: string; programTitle: string; bodyHtml: string } | null;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    emailVerified: boolean;
    referenceCode: string;
  } | null;
  events: AgreementEvent[];
  /** Correction-request history (most recent first). */
  changeRequests?: AgreementChangeRequestSummary[];
}

/** Rep raises a correction on a finalised agreement (bio OR payment plan). */
export function createChangeRequest(
  agreementId: string,
  input:
    | { type: 'BIO'; reason?: string; bioData: BioDataInput }
    | { type: 'PAYMENT_PLAN'; reason?: string; paymentPlan: PaymentPlanInput },
): Promise<AgreementChangeRequestSummary> {
  return apiFetch<AgreementChangeRequestSummary>(`/agreements/${agreementId}/change-requests`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Rep cancels their own pending correction request. */
export function cancelChangeRequest(id: string): Promise<AgreementChangeRequestSummary> {
  return apiFetch<AgreementChangeRequestSummary>(`/agreements/change-requests/${id}/cancel`, {
    method: 'POST',
  });
}

export function listTemplateOptions(): Promise<TemplateOption[]> {
  return apiFetch<TemplateOption[]>('/agreements/templates/options');
}

export function listAgreements(params?: {
  status?: string;
  mine?: boolean;
  leadId?: string;
}): Promise<AgreementSummary[]> {
  return apiFetch<AgreementSummary[]>(`/agreements${buildQuery({ ...params })}`);
}

export function getAgreement(id: string): Promise<AgreementDetail> {
  return apiFetch<AgreementDetail>(`/agreements/${id}`, { cache: 'no-store' });
}

export interface AgreementReviewCounts {
  /** Agreements submitted / under review — the Finance queue badge. */
  financeToReview: number;
  /** This user's agreements bounced back for changes — the Sales badge. */
  salesChangesRequested: number;
}

export function fetchAgreementReviewCounts(): Promise<AgreementReviewCounts> {
  return apiFetch<AgreementReviewCounts>('/agreements/review-counts', { cache: 'no-store' });
}

export function createAgreement(input: {
  leadId: string;
  templateId: string;
}): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>('/agreements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAgreement(
  id: string,
  input: {
    bioData?: BioDataInput;
    paymentPlan?: PaymentPlanInput;
    salesNotes?: string;
    contentHtml?: string;
  },
): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function submitAgreement(id: string): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}/submit`, { method: 'POST' });
}

/** Re-derive the document from template + current bio + plan. */
export function regenerateAgreement(id: string): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}/regenerate`, { method: 'POST' });
}

/** Soft-delete a draft agreement (blocked once approved / has a contract). */
export function deleteAgreement(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/agreements/${id}`, { method: 'DELETE' });
}

// ---- Finance review -----------------------------------------------------

export function approveAgreement(id: string): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}/approve`, { method: 'POST' });
}

export function requestAgreementChanges(
  id: string,
  note: string,
): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}/request-changes`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/** Finance emails the approved agreement PDF to the client → status SENT. */
export function sendAgreementToClient(id: string): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}/send`, { method: 'POST' });
}

export function getAgreementPdfUrl(id: string): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(`/agreements/${id}/pdf-url`, { cache: 'no-store' });
}

export async function previewAgreementPdf(id: string): Promise<Blob> {
  const res = await apiFetch<{ bytes: number; pdfBase64: string }>(
    `/agreements/${id}/preview`,
    { method: 'POST', cache: 'no-store' },
  );
  return base64ToPdfBlob(res.pdfBase64);
}

function base64ToPdfBlob(b64: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---- Client-side document composition (mirrors the backend render so the
//      live preview matches the generated PDF exactly) ---------------------

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fmtMoney = (n: number): string =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function renderPlanTableHtml(
  installments: PaymentInstallmentInput[],
  currency: string,
): string {
  if (!installments || installments.length === 0) {
    return '<p><em>Payment plan to be inserted.</em></p>';
  }
  const rows = installments
    .map((s, i) => {
      const amount = s.amount != null ? `${currency} ${fmtMoney(s.amount)}` : '—';
      const when =
        (s.trigger && s.trigger.trim()) ||
        (s.dueDate ? new Date(s.dueDate).toLocaleDateString('en-GB') : '—');
      return `<tr><td>${i + 1}</td><td>${escapeHtml(s.stage || '')}</td><td>${amount}</td><td>${escapeHtml(when)}</td></tr>`;
    })
    .join('');
  const total = installments.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  return `<table class="payplan"><thead><tr><th>#</th><th>Stage</th><th>Amount</th><th>Trigger / Due</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="2">Total</td><td>${currency} ${fmtMoney(total)}</td><td></td></tr></tbody></table>`;
}

/** Demonyms for the destination-country rewrite — mirror of the server map. */
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

/** Parsed destination-country terms; null when no country is known. */
function countryTerms(
  country?: string,
): { name: string; adjective: string; isCanada: boolean } | null {
  const c = (country || '').trim();
  if (!c) return null;
  return {
    name: c,
    adjective: COUNTRY_ADJECTIVES[c.toLowerCase()] ?? c,
    isCanada: c.toLowerCase() === 'canada',
  };
}

/**
 * Make the destination country appear everywhere in authored HTML — same
 * rules as the server, so the live preview matches the PDF: Canada-authored
 * wording is rewritten ("Canada" → country, "Canadian" → adjective), and
 * country-less templates get the adjective injected into Embassy mentions.
 */
function applyCountry(html: string, country?: string): string {
  const t = countryTerms(country);
  if (!t) return html;
  let out = html;
  if (!t.isCanada) {
    out = out
      .replace(/\bCanadian\b/g, escapeHtml(t.adjective))
      .replace(/\bCanada\b/g, escapeHtml(t.name));
  }
  // "(?! of )" keeps "the Embassy of X" intact — only bare mentions gain
  // the adjective, and already-qualified ones can't double up.
  const adj = escapeHtml(t.adjective);
  out = out.replace(
    /\b(the|The) (relevant |Relevant )?Embassy\b(?! of )/g,
    (_m, the: string, rel: string | undefined) => `${the} ${rel ?? ''}${adj} Embassy`,
  );
  // "the Client's visa application" → "...visa application for Norway";
  // skips already-qualified ("for X") and Embassy-bound ("application to")
  // mentions, where the country is named by the Embassy injection instead.
  out = out.replace(
    /\bvisa application\b(?! (for|to)\b)/g,
    `visa application for ${escapeHtml(t.name)}`,
  );
  // "by governmental authorities" → "by Norwegian governmental authorities";
  // article-anchored so adjectivised mentions can't double up.
  out = out.replace(
    /\b(by|the) governmental authorit(y|ies)\b/g,
    (_m, lead: string, tail: string) => `${lead} ${adj} governmental authorit${tail}`,
  );
  return out;
}

/** Plain-text Canada→country rewrite — for the program-title token. */
function applyCountryText(text: string, country?: string): string {
  const t = countryTerms(country);
  if (!t || t.isCanada) return text;
  return text.replace(/\bCanadian\b/g, t.adjective).replace(/\bCanada\b/g, t.name);
}

/**
 * Document heading with the destination appended in the firm's signed-
 * agreement style ("Temporary Resident Visa – Visit Visa Canada") unless the
 * title already names the country. Mirror of the server's applyCountryTitle,
 * so the editor preview heading matches the PDF.
 */
export function composeAgreementTitle(programTitle: string, country?: string): string {
  const t = countryTerms(country);
  if (!t) return programTitle;
  const out = applyCountryText(programTitle, country);
  const low = out.toLowerCase();
  if (low.includes(t.name.toLowerCase()) || low.includes(t.adjective.toLowerCase())) {
    return out;
  }
  return `${out} ${t.name}`;
}

/** Substitute bio + plan into a template body — same rules as the server. */
export function composeAgreementDocument(
  bodyHtml: string,
  bio: BioDataInput,
  plan: { currency: string; netPayable: number; installments: PaymentInstallmentInput[] },
  meta: { agreementNumber: string; programTitle: string },
): string {
  const currency = plan.currency || 'CAD';
  const vars: Record<string, string> = {
    AGREEMENT_NUMBER: meta.agreementNumber || '',
    AGREEMENT_DATE:
      bio.agreementDate && bio.agreementDate.trim()
        ? bio.agreementDate
        : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    // Rewrite-only: the token may sit mid-sentence, where a country prefix
    // reads badly. The PDF's big heading gains the prefix server-side.
    PROGRAM_TITLE: applyCountryText(meta.programTitle || '', bio.country),
    APPLICANT_NAME: bio.applicantName || '',
    FATHER_NAME: bio.fatherName || '',
    CNIC: bio.cnic || '',
    PASSPORT: bio.passport || '',
    DOB: bio.dob || '',
    NATIONALITY: bio.nationality || '',
    ADDRESS: bio.address || '',
    PHONE: bio.phone || '',
    EMAIL: bio.email || '',
    FILE_NUMBER: bio.fileNumber || '',
    TOTAL_AMOUNT: `${currency} ${fmtMoney(plan.netPayable)}`,
    CURRENCY: currency,
    COUNTRY: (bio.country || '').trim() || 'Canada',
  };
  // Country rewrite covers authored text only (template prose + plan table) —
  // applicant-entered values pass through token substitution untouched.
  let out = applyCountry(bodyHtml, bio.country).replace(
    /\{\{\s*PAYMENT_PLAN\s*\}\}/g,
    applyCountry(renderPlanTableHtml(plan.installments, currency), bio.country),
  );
  out = out.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k];
    if (v != null && v !== '') return escapeHtml(v);
    return `<span class="token-missing">[${k}]</span>`;
  });
  return out;
}
