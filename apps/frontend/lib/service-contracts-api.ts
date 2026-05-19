import { apiFetch } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth-client';

export type ServiceContractStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type InstallmentStatus = 'PENDING' | 'INVOICED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface ApiContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  referenceCode: string;
}

export interface ApiInvoiceRef {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalAmount?: string;
  paidAmount?: string;
  dueDate?: string | null;
}

export interface ApiInstallment {
  id: string;
  sequence: number;
  dueDate: string;
  amount: string;
  description: string | null;
  status: InstallmentStatus;
  invoice: ApiInvoiceRef | null;
}

export interface ApiServiceContract {
  id: string;
  contractNumber: string;
  leadId: string | null;
  clientId: string | null;
  totalAmount: string;
  currency: string;
  signedDate: string | null;
  notes: string | null;
  status: ServiceContractStatus;
  agreementKey: string | null;
  agreementFileName: string | null;
  agreementMimeType: string | null;
  agreementSizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  lead: ApiContact | null;
  client: ApiContact | null;
  installments: ApiInstallment[];
}

export interface UploadAgreementInput {
  leadId?: string;
  clientId?: string;
  totalAmount: number;
  currency?: string;
  signedDate?: string;
  notes?: string;
}

export interface CreateInstallmentInput {
  sequence: number;
  dueDate: string;
  amount: number;
  description?: string;
}

export interface CreateServiceContractInput {
  leadId?: string;
  clientId?: string;
  totalAmount: number;
  currency?: string;
  signedDate?: string;
  notes?: string;
  installments: CreateInstallmentInput[];
}

export interface ListContractsFilters {
  status?: ServiceContractStatus;
  leadId?: string;
  clientId?: string;
  search?: string;
}

export async function listServiceContracts(filters: ListContractsFilters = {}): Promise<ApiServiceContract[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.leadId) params.set('leadId', filters.leadId);
  if (filters.clientId) params.set('clientId', filters.clientId);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();
  return apiFetch<ApiServiceContract[]>(`/finance/service-contracts${qs ? `?${qs}` : ''}`);
}

export async function getServiceContract(id: string): Promise<ApiServiceContract> {
  return apiFetch<ApiServiceContract>(`/finance/service-contracts/${id}`);
}

export async function createServiceContract(
  input: CreateServiceContractInput,
): Promise<ApiServiceContract> {
  return apiFetch<ApiServiceContract>('/finance/service-contracts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateServiceContract(
  id: string,
  input: { status?: ServiceContractStatus; notes?: string; signedDate?: string },
): Promise<ApiServiceContract> {
  return apiFetch<ApiServiceContract>(`/finance/service-contracts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function generateInvoiceForInstallment(installmentId: string): Promise<{
  id: string;
  invoiceNumber: string;
}> {
  return apiFetch<{ id: string; invoiceNumber: string }>(
    `/finance/service-contracts/installments/${installmentId}/generate-invoice`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function uploadServiceAgreement(
  input: UploadAgreementInput,
  file: File,
): Promise<ApiServiceContract> {
  const token = getAccessToken();
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'https://backend-production-5a89.up.railway.app';
  const form = new FormData();
  form.append('file', file);
  if (input.leadId) form.append('leadId', input.leadId);
  if (input.clientId) form.append('clientId', input.clientId);
  form.append('totalAmount', String(input.totalAmount));
  if (input.currency) form.append('currency', input.currency);
  if (input.signedDate) form.append('signedDate', input.signedDate);
  if (input.notes) form.append('notes', input.notes);

  const res = await fetch(`${base}/finance/service-contracts/upload-agreement`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Upload failed (${res.status})`);
  }
  return res.json() as Promise<ApiServiceContract>;
}

export async function addInstallments(
  contractId: string,
  installments: CreateInstallmentInput[],
): Promise<ApiServiceContract> {
  return apiFetch<ApiServiceContract>(
    `/finance/service-contracts/${contractId}/installments`,
    { method: 'POST', body: JSON.stringify({ installments }) },
  );
}

export async function getAgreementDownloadUrl(contractId: string): Promise<{
  url: string;
  fileName: string;
  mimeType: string | null;
}> {
  return apiFetch<{ url: string; fileName: string; mimeType: string | null }>(
    `/finance/service-contracts/${contractId}/agreement-url`,
  );
}

// Helper to display a contact's full name with a fallback to phone.
export function displayContactName(contact: ApiContact | null): string {
  if (!contact) return '—';
  const full = `${contact.firstName} ${contact.lastName}`.trim();
  return full || contact.phone || '—';
}

export function fmtMoney(amount: string | number, currency: string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!isFinite(n)) return `${currency} ${amount}`;
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
