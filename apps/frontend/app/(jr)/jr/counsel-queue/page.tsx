'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { Gavel, Loader2 } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
} from '@/components/sales-v2/ui';
import { useJrSession } from '@/components/layout/JrShell';
import {
  fetchJrCounselQueue,
  jrFmtDate,
  jrHumanize,
  type JrCounselQueueRow,
} from '@/lib/jr';

/**
 * Counsel queue — every artifact currently in COUNSEL_REVIEW across all matters,
 * oldest first. Head-only (`jr.matter.view_all`); the backend gates the endpoint
 * and the nav item is hidden for associates.
 */

const GRID = 'minmax(140px, 1.1fr) minmax(220px, 2.4fr) minmax(160px, 1.4fr) 130px';

export default function JrCounselQueuePage() {
  const { user } = useJrSession();
  const canViewAll = user.permissions.includes('jr.matter.view_all');

  const [rows, setRows] = useState<JrCounselQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewAll) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJrCounselQueue()
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load counsel queue');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [canViewAll]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Approval gate"
        title="Counsel Queue"
        description="Artifacts submitted to counsel and awaiting review, oldest first."
      />

      {!canViewAll ? (
        <EmptyState
          Icon={Gavel}
          title="Head console only"
          description="The counsel queue is available to Judicial Review heads."
        />
      ) : (
        <GlassCard variant="panel" padded={false}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 780 }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '9px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                <span>Matter</span>
                <span>Artifact</span>
                <span>Type</span>
                <span>Submitted</span>
              </div>

              {loading ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Loader2 size={14} className="sos-spin" /> Loading…
                </div>
              ) : error ? (
                <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load counsel queue: {error}</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 8 }}>
                  <EmptyState
                    Icon={Gavel}
                    title="Nothing awaiting counsel"
                    description="Artifacts appear here when an associate submits them to counsel for review."
                  />
                </div>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.artifactId}
                    style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '13px 16px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)' }}
                  >
                    <Link href={`/jr/matters/${r.matterId}` as Route} style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)', textDecoration: 'none' }}>
                      {r.matterNumber}
                    </Link>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                      {r.styleOfCause ? (
                        <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.styleOfCause}</div>
                      ) : null}
                    </div>
                    <div>
                      <StatusBadge tone="info" size="sm" dot={false}>{jrHumanize(r.artifactType)}</StatusBadge>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>{jrFmtDate(r.submittedAt)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
