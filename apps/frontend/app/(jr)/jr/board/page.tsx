'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
} from '@/components/sales-v2/ui';
import {
  fetchJrBoard,
  jrDueInfo,
  jrFmtDate,
  jrHumanize,
  type JrBoardRow,
} from '@/lib/jr';

/**
 * JR deadline board — every PENDING deadline across the matters the caller can
 * see (server-scoped). A fatal-only toggle narrows to the un-missable dates.
 */

const GRID = 'minmax(140px, 1.2fr) minmax(220px, 2.4fr) 130px 90px 130px';

export default function JrBoardPage() {
  const [rows, setRows] = useState<JrBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fatalOnly, setFatalOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJrBoard({ fatalOnly })
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load board');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fatalOnly]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Federal Court"
        title="Deadline Board"
        description="Pending fatal and procedural deadlines across your matters, soonest first."
        actions={
          <button
            type="button"
            onClick={() => setFatalOnly((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 'var(--sos-radius-md)',
              border: `1px solid ${fatalOnly ? 'var(--sos-status-danger)' : 'var(--sos-border-subtle)'}`,
              background: fatalOnly ? 'var(--sos-status-danger-soft)' : 'transparent',
              color: fatalOnly ? 'var(--sos-status-danger)' : 'var(--sos-text-secondary)',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <AlertTriangle size={14} /> Fatal only
          </button>
        }
      />

      <GlassCard variant="panel" padded={false}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '9px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <span>Matter</span>
              <span>Milestone</span>
              <span>Due</span>
              <span>Fatal</span>
              <span>Countdown</span>
            </div>

            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Loader2 size={14} className="sos-spin" /> Loading…
              </div>
            ) : error ? (
              <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load board: {error}</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 8 }}>
                <EmptyState
                  Icon={CalendarClock}
                  title={fatalOnly ? 'No pending fatal deadlines' : 'No pending deadlines'}
                  description="Deadlines appear here once a matter's clock has started."
                />
              </div>
            ) : (
              rows.map((d) => {
                const due = jrDueInfo(d.effectiveDueAt);
                return (
                  <div
                    key={d.id}
                    style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '13px 16px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)' }}
                  >
                    <Link href={`/jr/matters/${d.matterId}` as Route} style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)', textDecoration: 'none' }}>
                      {d.matterNumber}
                    </Link>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.label || jrHumanize(d.milestoneKey)}
                      </div>
                      {d.styleOfCause ? (
                        <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.styleOfCause}</div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>{jrFmtDate(d.effectiveDueAt)}</div>
                    <div>
                      {d.isFatal ? (
                        <StatusBadge tone="danger" size="sm" dot={false}>Fatal</StatusBadge>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>—</span>
                      )}
                    </div>
                    <div>
                      <StatusBadge tone={due.tone} size="sm">{due.label}</StatusBadge>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
