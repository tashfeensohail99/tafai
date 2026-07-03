/**
 * reception-api.ts
 * Front-desk / Reception module API adapter. Backend routes live under
 * /reception (see apps/backend/src/modules/reception).
 */
import { apiFetch, buildQuery } from './api-client';

export type VisitType = 'WALK_IN' | 'EXISTING_CLIENT' | 'PAID_CONSULT';
export type VisitStatus = 'WAITING' | 'IN_MEETING' | 'DONE' | 'NO_SHOW' | 'CANCELLED';

export interface LookupHit {
  kind: 'lead' | 'client';
  id: string;
  name: string;
  phone: string | null;
  referenceCode: string;
  status: string;
  owner: string | null;
}

export interface VisitRow {
  id: string;
  visitType: VisitType;
  status: VisitStatus;
  name: string;
  phone: string | null;
  purpose: string | null;
  notes: string | null;
  leadId: string | null;
  clientId: string | null;
  hostEmployeeId: string | null;
  referenceCode: string | null;
  hostName: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
}

export interface VisitList {
  date: string;
  counts: {
    total: number;
    waiting: number;
    inMeeting: number;
    done: number;
    walkIn: number;
    existing: number;
    paid: number;
  };
  visits: VisitRow[];
}

export interface CreateVisitInput {
  visitType: VisitType;
  name: string;
  phone?: string;
  leadId?: string;
  clientId?: string;
  hostEmployeeId?: string;
  purpose?: string;
  notes?: string;
}

export async function receptionLookup(q: string): Promise<{ results: LookupHit[] }> {
  return apiFetch<{ results: LookupHit[] }>(`/reception/lookup${buildQuery({ q })}`);
}

export async function listVisits(
  params: { date?: string; status?: VisitStatus; type?: VisitType } = {},
): Promise<VisitList> {
  return apiFetch<VisitList>(`/reception/visits${buildQuery(params)}`, { cache: 'no-store' });
}

export async function createVisit(input: CreateVisitInput): Promise<VisitRow> {
  return apiFetch<VisitRow>('/reception/visits', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateVisit(
  id: string,
  patch: { status?: VisitStatus; hostEmployeeId?: string | null; notes?: string },
): Promise<VisitRow> {
  return apiFetch<VisitRow>(`/reception/visits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
