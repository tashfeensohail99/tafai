import { apiFetch } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth-client';

export type LeadImportStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
export type LeadImportRowOutcome = 'IMPORTED' | 'DUPLICATE' | 'INVALID' | 'FAILED';

export interface ColumnMapping {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  alternatePhone?: string;
  nationality?: string;
  targetCountry?: string;
  serviceInterest?: string;
  city?: string;
  notes?: string;
  sourceLabel?: string;
}

export interface PreviewResult {
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  suggestedMapping: Partial<ColumnMapping>;
  sourceFormat: 'csv' | 'xlsx';
}

export interface AgentBreakdownRow {
  employeeId: string | null;
  employeeName: string;
  count: number;
}

export interface LeadImportBatch {
  id: string;
  batchNumber: string;
  name: string;
  uploadedByUserId: string;
  uploadedAt: string;
  fileName: string;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  assignedCount: number;
  status: LeadImportStatus;
  selectedAgentIds: string[];
  columnMapping: ColumnMapping;
  defaultCountry: string;
  welcomeMessage: string | null;
  errorReportKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  uploadedBy?: { id: string; email: string };
  agentBreakdown?: AgentBreakdownRow[];
}

export interface StartImportInput {
  name: string;
  columnMapping: ColumnMapping;
  defaultCountry?: string;
  selectedAgentIds?: string[];
  welcomeMessage?: string;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

async function uploadMultipart<T>(
  path: string,
  file: File,
  fields: Record<string, string | string[]> = {},
): Promise<T> {
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      for (const item of v) form.append(k, item);
    } else if (v !== undefined && v !== null && v !== '') {
      form.append(k, v);
    }
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function previewImport(file: File): Promise<PreviewResult> {
  return uploadMultipart<PreviewResult>('/admin/lead-imports/preview', file);
}

export async function startImport(
  file: File,
  input: StartImportInput,
): Promise<LeadImportBatch> {
  // FormData wants strings — JSON-stringify the mapping object.
  return uploadMultipart<LeadImportBatch>('/admin/lead-imports', file, {
    name: input.name,
    columnMapping: JSON.stringify(input.columnMapping),
    defaultCountry: input.defaultCountry ?? 'PK',
    welcomeMessage: input.welcomeMessage ?? '',
    // Express's body parser unpacks repeated `selectedAgentIds[]` form fields.
    selectedAgentIds: input.selectedAgentIds ?? [],
  });
}

export async function listImportBatches(filters: {
  status?: LeadImportStatus;
  search?: string;
} = {}): Promise<LeadImportBatch[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.search) qs.set('search', filters.search);
  const suffix = qs.toString();
  return apiFetch<LeadImportBatch[]>(
    `/admin/lead-imports${suffix ? `?${suffix}` : ''}`,
  );
}

export async function getImportBatch(id: string): Promise<LeadImportBatch> {
  return apiFetch<LeadImportBatch>(`/admin/lead-imports/${id}`);
}

export async function pauseImport(id: string): Promise<LeadImportBatch> {
  return apiFetch<LeadImportBatch>(`/admin/lead-imports/${id}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function resumeImport(id: string): Promise<LeadImportBatch> {
  return apiFetch<LeadImportBatch>(`/admin/lead-imports/${id}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Bulk delete a batch and every Lead it created. Server cascades the
 * soft-delete to the Lead rows so they vanish from sales + admin lead
 * lists and WhatsApp inboxes. Returns the count of leads that were
 * actually marked deleted (excludes DUPLICATE / INVALID rows which never
 * created a lead, and IMPORTED leads that were already deleted).
 */
export async function deleteImport(id: string): Promise<{ success: true; deletedLeads: number }> {
  return apiFetch<{ success: true; deletedLeads: number }>(
    `/admin/lead-imports/${id}`,
    { method: 'DELETE' },
  );
}

export interface LeadInBatch {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  referenceCode: string;
  assignedEmployee: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

/**
 * List the leads created by a batch — drives the per-batch "Leads"
 * panel. Server caps at 500 rows; combine with the search filter to
 * narrow huge batches further.
 *
 *   assignedEmployeeId  pass the UUID to filter by an agent, or the
 *                       literal "unassigned" to find leads with no
 *                       assignee. Omit for all.
 */
export async function listLeadsInBatch(
  batchId: string,
  opts: { search?: string; assignedEmployeeId?: string } = {},
): Promise<LeadInBatch[]> {
  const qs = new URLSearchParams();
  if (opts.search) qs.set('search', opts.search);
  if (opts.assignedEmployeeId) qs.set('assignedEmployeeId', opts.assignedEmployeeId);
  const suffix = qs.toString();
  return apiFetch<LeadInBatch[]>(
    `/admin/lead-imports/${batchId}/leads${suffix ? `?${suffix}` : ''}`,
  );
}

/** Soft-delete a single lead. Used by the per-batch list's row delete button. */
export async function deleteLead(leadId: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(`/leads/${leadId}`, { method: 'DELETE' });
}

/** Bulk-delete an explicit set of leads. Cap 500. */
export async function bulkDeleteLeads(ids: string[]): Promise<{ success: true; deleted: number }> {
  return apiFetch<{ success: true; deleted: number }>(`/leads/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export function downloadErrorsCsv(id: string, batchNumber: string): void {
  const token = getAccessToken();
  const url = `${baseUrl()}/admin/lead-imports/${id}/errors.csv`;
  // Easiest cross-browser: open in a new tab with auth header forwarded
  // via fetch → blob → download.
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `${batchNumber}-errors.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    })
    .catch(() => {
      // Surface failure via the same alert pattern used elsewhere.
      // eslint-disable-next-line no-alert
      alert('Failed to download error report');
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Welcome-message helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default welcome message — the one the user signed off in section 5 of
 * the spec. The `wa.me` button on a lead pre-fills this so the rep just
 * has to hit send from their personal WhatsApp.
 *
 * Placeholders supported (rendered with naive `replace()`):
 *   {firstName}      lead's first name (falls back to "there")
 *   {businessNumber} the business WhatsApp number to redirect customer to
 */
const DEFAULT_WELCOME = [
  'Hello 👋',
  'This is Tashfeen Immigration Solutions.',
  '',
  '+92 3350001111',
  '',
  'To continue your visa/immigration inquiry, please reply to number +92 3350001111 with:',
  '',
  '1️⃣ Your name',
  '2️⃣ Country of interest',
  '3️⃣ Visa type or service required',
  '',
  'Our consultant will guide you further.',
  '',
  'Thank you,',
  'Tashfeen Immigration Solutions',
].join('\n');

export function renderWelcomeMessage(
  template: string | null | undefined,
  vars: { firstName?: string | null; businessNumber?: string },
): string {
  const tpl = template?.trim() || DEFAULT_WELCOME;
  return tpl
    .replace(/\{firstName\}/g, vars.firstName?.trim() || 'there')
    .replace(/\{businessNumber\}/g, vars.businessNumber ?? '+92 3350001111');
}

/**
 * Build a WhatsApp Web deep link that opens the rep's WhatsApp straight to the
 * lead's chat with the welcome message pre-filled. We target web.whatsapp.com
 * (not wa.me) to skip the wa.me "Continue to Chat" interstitial — our reps work
 * in WhatsApp Web, so this lands on the chat in one hop. Pure digits, no `+`.
 */
export function waWebLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
}
