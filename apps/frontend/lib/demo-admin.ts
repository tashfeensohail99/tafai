import { apiFetch } from './api-client';

export interface DemoAccessLinkUse {
  id: string;
  usedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DemoAccessLink {
  id: string;
  label: string;
  role: 'admin' | 'agent';
  tokenTail: string;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  active: boolean;
  uses?: DemoAccessLinkUse[];
  /** Only present on the create response — shown once. */
  url?: string;
}

export interface DemoSyncTableResult {
  table: string;
  mode: 'full' | 'incremental';
  read: number;
  written: number;
  pruned: number;
  skipped: number;
  ms: number;
  error?: string;
}

export interface DemoStatus {
  demoMode: boolean;
  syncEnabled: boolean;
  configured: boolean;
  running: boolean;
  lastResult: { startedAt: string; finishedAt: string; full: boolean; ok: boolean; tables: DemoSyncTableResult[] } | null;
  lastLeakCheck: { ok: boolean; scannedTables: number; scannedRows: number; findings: Array<{ table: string; column: string; pk: string; kind: string; match: string }>; ms: number } | null;
  state: Array<{ table: string; watermark: string | null; lastRunAt: string | null; lastFullAt: string | null; rowsCopied: string }>;
  recentRuns: Array<{ id: string; startedAt: string; finishedAt: string; isFull: boolean; ok: boolean }>;
}

export function getDemoStatus(): Promise<DemoStatus> {
  return apiFetch<DemoStatus>('/demo/admin/status', { cache: 'no-store' });
}

export function runDemoSync(full: boolean): Promise<DemoStatus['lastResult']> {
  return apiFetch('/demo/admin/sync', { method: 'POST', body: JSON.stringify({ full }) });
}

export function runDemoLeakCheck(): Promise<NonNullable<DemoStatus['lastLeakCheck']>> {
  return apiFetch('/demo/admin/leak-check', { method: 'POST', body: '{}' });
}

export function listDemoLinks(): Promise<DemoAccessLink[]> {
  return apiFetch<DemoAccessLink[]>('/demo/admin/access-links', { cache: 'no-store' });
}

export function createDemoLink(input: { label: string; role: 'admin' | 'agent'; hours: number; maxUses?: number }): Promise<DemoAccessLink> {
  return apiFetch<DemoAccessLink>('/demo/admin/access-links', { method: 'POST', body: JSON.stringify(input) });
}

export function revokeDemoLink(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/demo/admin/access-links/${id}`, { method: 'DELETE' });
}
