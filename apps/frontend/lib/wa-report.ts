'use client';

import { apiFetch, buildQuery } from './api-client';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface RepActivity {
  employeeId: string | null;
  name: string;
  texted: number;
  replied: number;
  replyPct: number;
  newContacts: number;
  newReplied: number;
  oldContacts: number;
  oldReplied: number;
  awaiting: number;
}

export interface AwaitingContact {
  employeeId: string | null;
  repName: string;
  contact: string | null;
  phone: string | null;
  lastInboundAt: string | null;
  isOld: boolean;
}

export interface WhatsAppReport {
  period: ReportPeriod;
  label: string;
  from: string;
  to: string;
  totals: {
    texted: number;
    replied: number;
    replyPct: number;
    newContacts: number;
    newReplied: number;
    oldContacts: number;
    oldReplied: number;
    awaiting: number;
  };
  reps: RepActivity[];
  awaitingContacts: AwaitingContact[];
  awaitingTruncated: boolean;
}

export function fetchWhatsAppReport(period: ReportPeriod): Promise<WhatsAppReport> {
  return apiFetch<WhatsAppReport>(`/admin/whatsapp-report${buildQuery({ period })}`, { cache: 'no-store' });
}
