'use client';

import { apiFetch } from './api-client';

export type LeadWhatsappMode = 'personal' | 'crm';

export function getLeadWhatsappMode(): Promise<{ leadWhatsappMode: LeadWhatsappMode }> {
  return apiFetch<{ leadWhatsappMode: LeadWhatsappMode }>('/admin/app-settings/lead-whatsapp-mode', {
    cache: 'no-store',
  });
}

export function setLeadWhatsappMode(
  leadWhatsappMode: LeadWhatsappMode,
): Promise<{ leadWhatsappMode: LeadWhatsappMode }> {
  return apiFetch<{ leadWhatsappMode: LeadWhatsappMode }>('/admin/app-settings/lead-whatsapp-mode', {
    method: 'PATCH',
    body: JSON.stringify({ leadWhatsappMode }),
    cache: 'no-store',
  });
}
