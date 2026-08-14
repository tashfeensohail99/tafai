'use client';

import { apiFetch } from './api-client';

export interface FamilyMember {
  id: string;
  name: string;
  referenceCode: string;
  cnic: string | null;
  agreementCount: number;
}

export interface ClientFamily {
  payer: FamilyMember & { phone: string | null; email: string | null };
  dependents: FamilyMember[];
}

/** Payer + dependent applicants for a client (works given the payer OR a dependent id). */
export function fetchClientFamily(clientId: string): Promise<ClientFamily> {
  return apiFetch<ClientFamily>(`/clients/${encodeURIComponent(clientId)}/family`, { cache: 'no-store' });
}

/**
 * Add a dependent applicant (family / group member) under a payer. The dependent
 * gets its own file number + case + ledger, shares the payer's contact, and has
 * no phone of its own.
 */
export function createDependentApplicant(
  payerId: string,
  input: { firstName: string; lastName: string; cnic?: string; nationality?: string },
): Promise<{ id: string; referenceCode: string }> {
  return apiFetch<{ id: string; referenceCode: string }>(`/clients/${encodeURIComponent(payerId)}/dependents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
