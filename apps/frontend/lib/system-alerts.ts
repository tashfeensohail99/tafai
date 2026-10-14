import { apiFetch } from '@/lib/api-client';

export interface SystemAlert {
  key: string;
  severity: 'critical' | 'warning' | string;
  title: string;
  message: string;
  startedAt: string | null;
}

/** Active service-health alerts (empty when everything is healthy). */
export function fetchSystemAlerts(): Promise<SystemAlert[]> {
  return apiFetch<SystemAlert[]>('/system/alerts', { cache: 'no-store' });
}
