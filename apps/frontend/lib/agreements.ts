'use client';

import { apiFetch } from './api-client';

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
  const binary = atob(res.pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}
