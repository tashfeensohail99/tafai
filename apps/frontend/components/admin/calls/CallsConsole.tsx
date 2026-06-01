'use client';
// Admin WhatsApp Calls log — org-wide history of inbound (and, soon, outbound)
// WhatsApp calls: who called, who handled it, answered vs missed, and duration.
// KPI totals come from the dedicated /stats endpoint (accurate, all-time); the
// table is the recent call log with instant client-side filter/search + cursor
// "Load more". Self-refreshes when a call comes in or ends.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  RefreshCw,
  Search,
} from 'lucide-react';
import { apiFetch, buildQuery } from '@/lib/api-client';
import { useAdminSession } from '@/components/layout/AdminShell';
import { PageHeader, GhostButton, EmptyState, MetricCard } from '@/components/sales-v2/ui';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useWhatsAppEvent } from '@/lib/whatsapp-realtime';

interface CallRow {
  id: string;
  direction: string; // INBOUND | OUTBOUND
  status: string; // RINGING | ANSWERED | ENDED | MISSED | FAILED
  event: string | null;
  phone: string | null;
  contactName: string | null;
  contactType: 'lead' | 'client' | null;
  leadId: string | null;
  clientId: string | null;
  threadId: string | null;
  assignedEmployeeName: string | null;
  answeredByEmployeeName: string | null;
  durationSeconds: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}
interface CallsResponse {
  items: CallRow[];
  nextBefore: string | null;
}
interface CallStats {
  total: number;
  missed: number;
  answered: number;
  avgDurationSeconds: number;
}

type DirFilter = 'all' | 'INBOUND' | 'OUTBOUND';
type OutcomeFilter = 'all' | 'answered' | 'missed';

const PAGE = 100;

const whenFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

function fmtWhen(iso: string): string {
  try {
    return whenFmt.format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isAnswered(c: CallRow): boolean {
  return !!c.answeredByEmployeeName || (c.durationSeconds ?? 0) > 0 || c.status === 'ANSWERED';
}

function outcomeOf(c: CallRow): { label: string; tone: string } {
  if (c.status === 'MISSED') return { label: 'Missed', tone: 'var(--sos-status-danger)' };
  if (c.status === 'FAILED') return { label: 'Failed', tone: 'var(--sos-status-danger)' };
  if (c.status === 'RINGING') return { label: 'Ringing', tone: 'var(--sos-status-warning)' };
  if (isAnswered(c)) return { label: 'Answered', tone: 'var(--sos-status-success)' };
  return { label: 'Ended', tone: 'var(--sos-text-muted)' };
}

export function CallsConsole() {
  const { user } = useAdminSession();
  const canViewAll = (user?.permissions ?? []).includes('whatsapp.view_all_inboxes');

  const [stats, setStats] = useState<CallStats | null>(null);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [dir, setDir] = useState<DirFilter>('all');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [search, setSearch] = useState('');

  // Initial + refresh load (stats + first page in parallel).
  useEffect(() => {
    if (!canViewAll) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [s, page] = await Promise.all([
          apiFetch<CallStats>('/whatsapp/calls/stats', { cache: 'no-store' }),
          apiFetch<CallsResponse>(`/whatsapp/calls${buildQuery({ limit: PAGE })}`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        setStats(s);
        setRows(page.items);
        setNextBefore(page.nextBefore);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load calls');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canViewAll, refreshKey]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  // Live refresh when a call rings in or ends (fires for admins who are also
  // reps; pure-admin accounts fall back to the Refresh button).
  useWhatsAppEvent('whatsapp.call.incoming', bump);
  useWhatsAppEvent('whatsapp.call.ended', bump);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<CallsResponse>(
        `/whatsapp/calls${buildQuery({ limit: PAGE, before: nextBefore })}`,
        { cache: 'no-store' },
      );
      setRows((prev) => [...prev, ...page.items]);
      setNextBefore(page.nextBefore);
    } catch {
      /* ignore — Refresh recovers */
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (dir !== 'all' && c.direction !== dir) return false;
      if (outcome === 'missed' && c.status !== 'MISSED') return false;
      if (outcome === 'answered' && !isAnswered(c)) return false;
      if (q) {
        const hay = `${c.phone ?? ''} ${c.contactName ?? ''} ${c.assignedEmployeeName ?? ''} ${c.answeredByEmployeeName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, dir, outcome, search]);

  if (!canViewAll) return <PermissionDeniedState />;
  if (loading) return <LoadingState message="Loading calls…" />;
  if (error) return <ErrorState message="Could not load calls" details={error} onRetry={bump} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Admin"
        title="WhatsApp Calls"
        description="Every WhatsApp call routed to the team — answered, missed, who handled it, and for how long."
        actions={
          <GhostButton size="sm" iconLeft={<RefreshCw size={15} />} onClick={bump}>
            Refresh
          </GhostButton>
        }
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <MetricCard label="Total calls" value={stats?.total ?? 0} hint="All time" tone="info" Icon={PhoneCall} />
        <MetricCard label="Answered" value={stats?.answered ?? 0} hint="Picked up in-app" tone="success" Icon={CheckCircle2} />
        <MetricCard label="Missed" value={stats?.missed ?? 0} hint="Unanswered" tone="danger" Icon={PhoneMissed} />
        <MetricCard label="Avg duration" value={fmtDuration(stats?.avgDurationSeconds ?? 0)} hint="Answered calls" tone="info" Icon={Clock} />
      </div>

      {/* Filters */}
      <div className="sos-glass sos-glass--panel" style={{ padding: 16, borderRadius: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Segmented
          value={dir}
          onChange={(v) => setDir(v as DirFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'INBOUND', label: 'Inbound' },
            { value: 'OUTBOUND', label: 'Outbound' },
          ]}
        />
        <Segmented
          value={outcome}
          onChange={(v) => setOutcome(v as OutcomeFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'answered', label: 'Answered' },
            { value: 'missed', label: 'Missed' },
          ]}
        />
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, name, agent…"
            style={{
              width: '100%',
              height: 38,
              paddingLeft: 34,
              paddingRight: 12,
              borderRadius: 10,
              border: '1px solid var(--sos-border-subtle)',
              background: 'var(--sos-surface-2)',
              color: 'var(--sos-text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
          />
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
          Showing <strong style={{ color: 'var(--sos-text-secondary)' }}>{filtered.length}</strong> of {rows.length}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          Icon={Phone}
          title="No calls"
          description={rows.length ? 'No calls match the current filters.' : 'No WhatsApp calls yet. Inbound calls will appear here as they arrive.'}
        />
      ) : (
        <div className="sos-glass sos-glass--panel" style={{ borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)' }}>
                  <Th>When</Th>
                  <Th>Contact</Th>
                  <Th>Direction</Th>
                  <Th>Outcome</Th>
                  <Th>Duration</Th>
                  <Th>Handled by</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const o = outcomeOf(c);
                  const inbound = c.direction !== 'OUTBOUND';
                  const DirIcon = c.status === 'MISSED' ? PhoneMissed : inbound ? PhoneIncoming : PhoneOutgoing;
                  return (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                      <Td>{fmtWhen(c.createdAt)}</Td>
                      <Td>
                        <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                          {c.contactName ?? c.phone ?? 'Unknown'}
                        </div>
                        {c.contactName && c.phone ? (
                          <div style={{ color: 'var(--sos-text-muted)', fontSize: 12 }}>{c.phone}</div>
                        ) : null}
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-text-secondary)' }}>
                          <DirIcon size={14} /> {inbound ? 'Inbound' : 'Outbound'}
                        </span>
                      </Td>
                      <Td>
                        <Pill tone={o.tone}>{o.label}</Pill>
                      </Td>
                      <Td>{fmtDuration(c.durationSeconds)}</Td>
                      <Td>{c.answeredByEmployeeName ?? c.assignedEmployeeName ?? '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {nextBefore ? (
            <div style={{ padding: 12, textAlign: 'center', borderTop: '1px solid var(--sos-border-subtle)' }}>
              <GhostButton size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </GhostButton>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th style={{ padding: '11px 14px', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children }: { children: ReactNode }) {
  return <td style={{ padding: '12px 14px', color: 'var(--sos-text-secondary)', verticalAlign: 'top' }}>{children}</td>;
}
function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: tone,
        background: `color-mix(in srgb, ${tone} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              padding: '6px 14px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              background: active ? 'var(--sos-brand-primary)' : 'transparent',
              color: active ? '#fff' : 'var(--sos-text-secondary)',
              transition: 'all 120ms',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
