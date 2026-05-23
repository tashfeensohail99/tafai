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
}

export interface AgreementEvent {
  id: string;
  type: string;
  summary: string;
  actorUserId: string | null;
  createdAt: string;
}

export interface AgreementDetail extends AgreementSummary {
  templateId: string;
  bioData: BioDataInput;
  paymentPlan: PaymentPlanInput | Record<string, never>;
  contentHtml: string;
  salesNotes: string | null;
  financeNotes: string | null;
  paymentPlanLockedAt: string | null;
  template: { id: string; name: string; categoryKey: string; programTitle: string } | null;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    referenceCode: string;
  } | null;
  events: AgreementEvent[];
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
  input: { bioData?: BioDataInput; paymentPlan?: PaymentPlanInput; salesNotes?: string },
): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function submitAgreement(id: string): Promise<AgreementSummary> {
  return apiFetch<AgreementSummary>(`/agreements/${id}/submit`, { method: 'POST' });
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
