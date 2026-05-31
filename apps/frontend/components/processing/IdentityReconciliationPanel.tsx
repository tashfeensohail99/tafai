'use client';
// Identity reconciliation (Phase 4) — a case-level card that lines up the
// identity the parser extracted from every document against each other and the
// CRM client record, so an associate can spot "the passport and the CNIC
// disagree on date of birth" at a glance. Flag-only: it never rejects anything.

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from 'lucide-react';
import { GlassCard, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  fetchIdentityReconciliation,
  type ApiIdentityReconciliation,
  type IdentityOverallStatus,
} from '@/lib/processing';

const OVERALL: Record<
  IdentityOverallStatus,
  { tone: BadgeTone; label: string; icon: typeof ShieldCheck }
> = {
  ok: { tone: 'success', label: 'Consistent', icon: ShieldCheck },
  review: { tone: 'warning', label: 'Needs a look', icon: ShieldAlert },
  insufficient: { tone: 'neutral', label: 'No extracted data yet', icon: ShieldQuestion },
};

export function IdentityReconciliationPanel({ caseId }: { caseId: string }) {
  const [data, setData] = useState<ApiIdentityReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchIdentityReconciliation(caseId)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setOpen(r.overall === 'review'); // auto-expand only when there's a conflict
      })
      .catch(() => { /* best-effort panel */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [caseId]);

  if (loading || !data) return null;

  const meta = OVERALL[data.overall];
  const Icon = meta.icon;

  return (
    <GlassCard variant="panel" padded="md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          color: 'var(--sos-text-primary)',
        }}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Icon size={15} style={{ color: 'var(--sos-text-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Identity check</span>
        <StatusBadge tone={meta.tone} size="sm">{meta.label}</StatusBadge>
        <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
          {data.documentCount} document{data.documentCount === 1 ? '' : 's'} with identity data
        </span>
      </button>

      {open ? (
        data.overall === 'insufficient' ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sos-text-muted)' }}>
            No identity fields have been extracted from this case&apos;s documents yet. Values appear
            here once a passport / CNIC / bank statement has been processed.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.fields
              .filter((f) => f.sources.length > 0 || f.crmValue)
              .map((f) => {
                const conflict = f.status === 'conflict';
                return (
                  <div
                    key={f.key}
                    style={{
                      padding: '8px 10px', borderRadius: 'var(--sos-radius-md)',
                      border: '1px solid var(--sos-border-subtle)',
                      borderLeft: `3px solid ${conflict ? 'var(--sos-status-warning)' : 'var(--sos-border-subtle)'}`,
                      background: 'var(--sos-surface-hover)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{f.label}</span>
                      {conflict ? (
                        <StatusBadge tone="warning" size="sm">conflict</StatusBadge>
                      ) : f.status === 'agree' ? (
                        <StatusBadge tone="success" size="sm">agree</StatusBadge>
                      ) : null}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>
                        CRM: <strong style={{ color: 'var(--sos-text-secondary)' }}>{f.crmValue ?? '—'}</strong>
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {f.sources.length === 0 ? (
                        <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>No document provided this field.</span>
                      ) : (
                        f.sources.map((s) => (
                          <span
                            key={s.itemId}
                            title={s.documentName}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '3px 8px', borderRadius: 'var(--sos-radius-sm)',
                              fontSize: 11.5,
                              border: `1px solid ${s.matchesReference ? 'var(--sos-border-subtle)' : 'var(--sos-status-warning)'}`,
                              background: 'var(--sos-surface)',
                              color: 'var(--sos-text-secondary)',
                            }}
                          >
                            {s.matchesReference
                              ? <Check size={12} style={{ color: 'var(--sos-status-success)' }} />
                              : <X size={12} style={{ color: 'var(--sos-status-warning)' }} />}
                            <span style={{ color: 'var(--sos-text-muted)' }}>{s.documentName}:</span>
                            <strong style={{ color: 'var(--sos-text-primary)' }}>{s.value}</strong>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 2 }}>
              Flags only — confirm manually. Transliteration differences (Urdu ↔ English) are
              common and don&apos;t always mean a real mismatch; identity is never auto-rejected.
            </div>
          </div>
        )
      ) : null}
    </GlassCard>
  );
}
