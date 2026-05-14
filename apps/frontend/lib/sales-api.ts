/**
 * sales-api.ts
 * Adapter layer between backend REST API shapes and the Sales UI Lead/FollowUp/Appointment types.
 *
 * All components import their data via the hooks in this file instead of MOCK data.
 */

import { apiFetch } from '@/lib/api-client';
import type {
  Lead,
  FollowUp,
  Appointment,
  LeadStage,
  Priority,
  LeadSource,
  SlaStatus,
  FollowUpStatus,
  AppointmentStatus,
  AppointmentType,
} from '@/components/sales-v2/mockData';

// ---------------------------------------------------------------------------
// Backend API response shapes (partial — only fields we use)
// ---------------------------------------------------------------------------

export interface ApiLead {
  id: string;
  /** Human-readable, sequential reference code (TIS-YYYY-NNNNN). Stays
   *  with the lead through Client conversion — same code on both rows. */
  referenceCode?: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  emailVerified?: boolean;
  targetCountry?: string | null;
  serviceInterest?: string | null;
  sourceChannel?: string | null;
  status: string; // LeadStatus enum from Prisma
  priority?: string | null; // HOT | WARM | COLD | null
  notes?: string | null;
  /** Agreed total service fee. Decimal column → arrives as a string
   *  over JSON to preserve precision. Null when the deal isn't priced. */
  serviceFeeAmount?: string | null;
  serviceFeeCurrency?: string | null;
  assignedEmployee?: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
  _count?: { appointments: number; invoices: number; timelineEvents: number };
}

export interface ApiFollowUp {
  id: string;
  leadId: string;
  title: string;
  description?: string | null;
  contactMethod?: string | null;
  dueAt: string;
  status: string; // OPEN | COMPLETED | CANCELLED
  priority: string; // LOW | MEDIUM | HIGH | URGENT
  outcomeNotes?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lead?: { id: string; firstName: string; lastName: string } | null;
}

export interface ApiAppointment {
  id: string;
  leadId?: string | null;
  clientId?: string | null;
  title: string;
  appointmentType: string;
  status: string; // SCHEDULED | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED
  scheduledAt: string;
  durationMinutes: number;
  location?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lead?: { id: string; firstName: string; lastName: string } | null;
  client?: { id: string; firstName: string; lastName: string } | null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapStatus(backendStatus: string): LeadStage {
  switch (backendStatus) {
    case 'NEW':          return 'NEW';
    case 'CONTACTED':    return 'CONTACTED';
    case 'QUALIFIED':    return 'APPOINTMENT_BOOKED';
    case 'PROPOSAL_SENT':return 'PAYMENT_INTERESTED';
    case 'FOLLOW_UP':    return 'MEETING_NEEDED';
    case 'CONVERTED':    return 'SENT_TO_FINANCE';
    case 'LOST':         return 'NO_RESPONSE';
    default:             return 'NEW';
  }
}

export function mapStageToStatus(stage: LeadStage): string {
  switch (stage) {
    case 'NEW':                return 'NEW';
    case 'ASSIGNED':           return 'NEW';
    case 'CONTACTED':          return 'CONTACTED';
    case 'NO_RESPONSE':        return 'LOST';
    case 'MEETING_NEEDED':     return 'FOLLOW_UP';
    case 'APPOINTMENT_BOOKED': return 'QUALIFIED';
    case 'PAYMENT_INTERESTED': return 'PROPOSAL_SENT';
    case 'RECEIPT_UPLOADED':   return 'PROPOSAL_SENT';
    case 'SENT_TO_FINANCE':    return 'CONVERTED';
    default:                   return 'NEW';
  }
}

function mapPriority(p: string | null | undefined): Priority {
  if (!p) return 'MEDIUM';
  const u = p.toUpperCase();
  if (u === 'HOT' || u === 'HIGH')  return 'HIGH';
  if (u === 'COLD' || u === 'LOW')  return 'LOW';
  return 'MEDIUM';
}

export function mapPriorityToApi(p: Priority): string {
  if (p === 'HIGH')   return 'HOT';
  if (p === 'LOW')    return 'COLD';
  return 'WARM';
}

function mapSource(ch: string | null | undefined): LeadSource {
  switch ((ch ?? '').toUpperCase()) {
    case 'FACEBOOK':  return 'FACEBOOK';
    case 'INSTAGRAM': return 'INSTAGRAM';
    case 'WEBSITE':   return 'WEBSITE';
    case 'WHATSAPP':  return 'WHATSAPP';
    case 'REFERRAL':  return 'REFERRAL';
    case 'PHONE':     return 'PHONE';
    case 'WALK_IN':   return 'WALK_IN';
    default:          return 'PHONE';
  }
}

function mapSla(stage: LeadStage): SlaStatus {
  if (stage === 'SENT_TO_FINANCE') return 'COMPLETED';
  if (stage === 'NO_RESPONSE')     return 'OVERDUE';
  if (stage === 'PAYMENT_INTERESTED' || stage === 'APPOINTMENT_BOOKED') return 'UPCOMING';
  return 'ACTIVE';
}

function defaultNextAction(stage: LeadStage): string {
  switch (stage) {
    case 'NEW':                return 'First contact call';
    case 'ASSIGNED':           return 'First contact call';
    case 'CONTACTED':          return 'Follow up on WhatsApp';
    case 'NO_RESPONSE':        return 'Retry call in 24 hours';
    case 'MEETING_NEEDED':     return 'Book consultation appointment';
    case 'APPOINTMENT_BOOKED': return 'Send appointment reminder';
    case 'PAYMENT_INTERESTED': return 'Confirm payment & upload receipt';
    case 'RECEIPT_UPLOADED':   return 'Awaiting finance verification';
    case 'SENT_TO_FINANCE':    return 'Awaiting finance verification';
    default:                   return '';
  }
}

export function adaptLead(api: ApiLead): Lead {
  const stage = mapStatus(api.status);
  return {
    id: api.id,
    referenceCode: api.referenceCode ?? undefined,
    firstName: api.firstName,
    lastName: api.lastName,
    phone: api.phone,
    email: api.email ?? undefined,
    emailVerified: api.emailVerified ?? false,
    source: mapSource(api.sourceChannel),
    service: api.serviceInterest ?? 'Immigration',
    targetCountry: api.targetCountry ?? '—',
    assignedBy: api.assignedEmployee
      ? `${api.assignedEmployee.firstName} ${api.assignedEmployee.lastName}`
      : undefined,
    assignmentType: 'ADMIN',
    assignedAt: api.createdAt,
    priority: mapPriority(api.priority),
    stage,
    slaStatus: mapSla(stage),
    nextAction: defaultNextAction(stage),
    salesNote: api.notes ?? undefined,
    tags: [],
    serviceFeeAmount: api.serviceFeeAmount ?? undefined,
    serviceFeeCurrency: api.serviceFeeCurrency ?? undefined,
  };
}

function mapFollowUpStatus(status: string, dueAt: string): FollowUpStatus {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'CANCELLED') return 'COMPLETED';
  const now = Date.now();
  const due = new Date(dueAt).getTime();
  if (due < now) return 'OVERDUE';
  // Within next 24 hours = DUE_TODAY
  if (due - now < 24 * 3600 * 1000) return 'DUE_TODAY';
  return 'PENDING';
}

function mapContactMethod(m: string | null | undefined): FollowUp['channel'] {
  const u = (m ?? '').toUpperCase();
  if (u === 'WHATSAPP') return 'WHATSAPP';
  if (u === 'EMAIL') return 'EMAIL';
  if (u === 'IN_PERSON' || u === 'OFFICE') return 'IN_PERSON';
  return 'CALL';
}

export function adaptFollowUp(api: ApiFollowUp): FollowUp {
  const status = mapFollowUpStatus(api.status, api.dueAt);
  const clientName = api.lead
    ? `${api.lead.firstName} ${api.lead.lastName}`
    : 'Unknown';
  return {
    id: api.id,
    leadId: api.leadId,
    clientName,
    type: 'FIRST_CALL',
    channel: mapContactMethod(api.contactMethod),
    dueAt: api.dueAt,
    slaStatus: status === 'OVERDUE' ? 'OVERDUE' : status === 'DUE_TODAY' ? 'ACTIVE' : 'UPCOMING',
    linkedStage: 'NEW',
    reason: api.description ?? api.title,
    status,
    outcome: api.outcomeNotes ?? undefined,
  };
}

function mapApptStatus(s: string): AppointmentStatus {
  switch (s) {
    case 'CONFIRMED':   return 'BOOKED';
    case 'SCHEDULED':   return 'BOOKED';
    case 'COMPLETED':   return 'COMPLETED';
    case 'CANCELLED':   return 'CANCELLED';
    case 'NO_SHOW':     return 'NO_SHOW';
    case 'RESCHEDULED': return 'PENDING';
    default:            return 'PENDING';
  }
}

function mapApptType(t: string): AppointmentType {
  switch ((t ?? '').toUpperCase()) {
    case 'OFFICE_MEETING':  return 'OFFICE_MEETING';
    case 'VIDEO_CALL':      return 'VIDEO_CALL';
    case 'PHONE_CONSULT':   return 'PHONE_CONSULT';
    case 'OFFICE_VISIT':    return 'OFFICE_VISIT';
    default:                return 'OFFICE_MEETING';
  }
}

export function adaptAppointment(api: ApiAppointment): Appointment {
  const contact = api.lead ?? api.client;
  return {
    id: api.id,
    leadId: api.leadId ?? '',
    clientName: contact ? `${contact.firstName} ${contact.lastName}` : api.title,
    type: mapApptType(api.appointmentType),
    scheduledAt: api.scheduledAt,
    durationMin: api.durationMinutes,
    status: mapApptStatus(api.status),
    location: api.location ?? undefined,
    note: api.notes ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers (return adapted UI shapes)
// ---------------------------------------------------------------------------

export async function fetchLeads(): Promise<Lead[]> {
  const data = await apiFetch<ApiLead[]>('/leads');
  return (data ?? []).map(adaptLead);
}

export async function fetchLead(id: string): Promise<Lead | null> {
  try {
    const data = await apiFetch<ApiLead>(`/leads/${id}`);
    return data ? adaptLead(data) : null;
  } catch {
    return null;
  }
}

/**
 * PATCH /leads/:id — accepts both the pipeline fields (stage / priority /
 * notes) AND the identity fields (firstName / lastName / phone / email /
 * service / targetCountry). The UI splits them across two affordances:
 *   - "Save changes" on the lead profile Overview tab → pipeline fields
 *   - "Edit lead" modal (profile page header + chat panel) → identity
 * Both flows funnel through here so the backend mapping stays in one place.
 */
export async function patchLead(
  id: string,
  changes: {
    stage?: LeadStage;
    priority?: Priority;
    notes?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    serviceInterest?: string;
    targetCountry?: string;
    /** Agreed total service fee — the anchor for the lead's single
     *  Invoice. Passed as a numeric string to preserve decimal precision
     *  (e.g. "5000.00" rather than 5000). Set to "" to clear. */
    serviceFeeAmount?: string;
    serviceFeeCurrency?: string;
  },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (changes.stage !== undefined) body.status = mapStageToStatus(changes.stage);
  if (changes.priority !== undefined) body.priority = mapPriorityToApi(changes.priority);
  if (changes.notes !== undefined) body.notes = changes.notes;
  if (changes.firstName !== undefined) body.firstName = changes.firstName;
  if (changes.lastName !== undefined) body.lastName = changes.lastName;
  if (changes.phone !== undefined) body.phone = changes.phone;
  if (changes.email !== undefined) body.email = changes.email || undefined;
  if (changes.serviceInterest !== undefined) body.serviceInterest = changes.serviceInterest || undefined;
  if (changes.targetCountry !== undefined) body.targetCountry = changes.targetCountry || undefined;
  if (changes.serviceFeeAmount !== undefined) {
    // Empty string means "clear it" — pass null so the backend column
    // resets to NULL rather than persisting '0' or the string '""'.
    body.serviceFeeAmount = changes.serviceFeeAmount.trim() === ''
      ? null
      : changes.serviceFeeAmount.trim();
  }
  if (changes.serviceFeeCurrency !== undefined) {
    body.serviceFeeCurrency = changes.serviceFeeCurrency || null;
  }
  await apiFetch(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function sendLeadEmailVerification(leadId: string): Promise<{ sent: boolean }> {
  const data = await apiFetch<{ sent: boolean }>(`/leads/${leadId}/send-email-verification`, {
    method: 'POST',
  });
  return data ?? { sent: false };
}

export async function fetchFollowUps(leadId?: string): Promise<FollowUp[]> {
  const qs = leadId ? `?leadId=${leadId}` : '';
  const data = await apiFetch<ApiFollowUp[]>(`/follow-ups${qs}`);
  return (data ?? []).map(adaptFollowUp);
}

export async function fetchAppointments(leadId?: string): Promise<Appointment[]> {
  const qs = leadId ? `?leadId=${leadId}` : '';
  const data = await apiFetch<ApiAppointment[]>(`/appointments${qs}`);
  return (data ?? []).map(adaptAppointment);
}

export async function createAppointment(payload: {
  leadId?: string;
  title: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
}): Promise<ApiAppointment> {
  return apiFetch<ApiAppointment>('/appointments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createFollowUp(payload: {
  leadId: string;
  title: string;
  description?: string;
  contactMethod?: string;
  dueAt: string;
}): Promise<ApiFollowUp> {
  return apiFetch<ApiFollowUp>('/follow-ups', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function completeFollowUp(id: string, outcomeNotes?: string): Promise<void> {
  await apiFetch(`/follow-ups/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ outcomeNotes }),
  });
}

export async function patchFollowUp(id: string, payload: {
  status?: string;
  dueAt?: string;
}): Promise<void> {
  await apiFetch(`/follow-ups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function createFinanceHandover(payload: {
  leadId: string;
  submittedAmount: string;
  currency?: string;
  paymentMethod?: string;
  notes?: string;
  receiptFileName: string;
  receiptMimeType?: string;
  receiptContentBase64: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/finance/handovers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Lead file attachments
// ---------------------------------------------------------------------------

export interface ApiLeadFile {
  id: string;
  leadId: string;
  fileName: string;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
}

export async function fetchLeadFiles(leadId: string): Promise<ApiLeadFile[]> {
  return apiFetch<ApiLeadFile[]>(`/leads/${leadId}/files`);
}

export async function uploadLeadFile(leadId: string, file: File): Promise<ApiLeadFile> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://backend-production-5a89.up.railway.app';
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/leads/${leadId}/files`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<ApiLeadFile>;
}

export async function getLeadFileUrl(leadId: string, fileId: string): Promise<string> {
  const data = await apiFetch<{ url: string; fileName: string }>(
    `/leads/${leadId}/files/${fileId}/url`,
  );
  return data.url;
}

export async function deleteLeadFile(leadId: string, fileId: string): Promise<void> {
  await apiFetch(`/leads/${leadId}/files/${fileId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Finance handover history (for the "Finance" tab on the lead profile)
// ---------------------------------------------------------------------------

/**
 * One row in the finance handover ledger for a given lead. This is the
 * authoritative trail of every receipt the agent has shipped to Finance
 * and every decision Finance has returned. Sales sees this on the
 * lead profile's Finance tab; it's what closes the visibility gap that
 * left "where did Arslan's receipt go?" unanswered.
 */
export interface ApiLeadFinanceHandover {
  id: string;
  leadId: string;
  invoiceId: string | null;
  paymentId: string | null;
  createdByUserId: string;
  reviewedByUserId: string | null;
  status:
    | 'SUBMITTED'
    | 'IN_REVIEW'
    | 'PAYMENT_RECORDED'
    | 'PAYMENT_VERIFIED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'SENT_TO_PROCESSING';
  submittedAmount: string;
  currency: string;
  paymentMethod: string | null;
  transactionRef: string | null;
  notes: string | null;
  financeNotes: string | null;
  receiptFileName: string;
  receiptMimeType: string | null;
  receiptSizeBytes: number | null;
  receiptDownloadUrl: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /finance/handovers?leadId=<id>
 *
 * Returns every handover ever submitted for this lead, newest first.
 * Backend already filters by sales-agent ownership (the agent assigned
 * to the lead OR the agent who submitted the handover), so a sales rep
 * only sees their own leads' history.
 *
 * Returns [] (not null) when nothing has been sent to Finance yet — that
 * lets the Finance tab render an empty state without special-casing.
 */
export async function fetchLeadFinanceHandovers(
  leadId: string,
): Promise<ApiLeadFinanceHandover[]> {
  try {
    const data = await apiFetch<ApiLeadFinanceHandover[]>(
      `/finance/handovers?leadId=${encodeURIComponent(leadId)}`,
    );
    return data ?? [];
  } catch {
    // Sales rep without finance_handover.view_own permission, or backend
    // unreachable — return [] so the Finance tab still renders the empty
    // state instead of crashing the whole profile page.
    return [];
  }
}
