'use client';
// Identity reconciliation (Phase 4) — case-level identity consistency check.
// Reframed for clarity: lead with a plain-English verdict, then a per-DOCUMENT
// list that answers "does this file belong to the client?" at a glance. The raw
// field-by-field grid is tucked behind a toggle for the rarer case where the
// same person's documents merely disagree on a detail (a DOB typo, etc.).
// Flag-only by design: it never rejects anything; a human always decides.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
  ok: { tone: 'success', label: 'All documents match', icon: ShieldCheck },
  review: { tone: 'warning', label: 'Some need a look', icon: ShieldAlert },
  insufficient: { tone: 'neutral', label: 'No data yet', icon: ShieldQuestion },
};

// ── per-document pivot ───────────────────────────────────────────────────────
// The API gives us field rows (name / DOB / ...) each listing the documents that
// supplied a value. To answer "is this file the right person?" we flip that into
// one entry per document, carrying which fields it agreed/disagreed on.
interface DocCell {
  label: string;
  value: string;
  matches: boolean;
}
interface DocView {
  itemId: string;
  documentName: string;
  cells: DocCell[];
  nameMismatch: boolean;
  anyMismatch: boolean;
}

function buildDocViews(data: ApiIdentityReconciliation): DocView[] {
  const map = new Map<string, DocView>();
  for (const f of data.fields) {
    for (const s of f.sources) {
      let dv = map.get(s.itemId);
      if (!dv) {
        dv = {
          itemId: s.itemId,
          documentName: s.documentName,
          cells: [],
          nameMismatch: false,
          anyMismatch: false,
        };
        map.set(s.itemId, dv);
      }
      dv.cells.push({ label: f.label, value: s.value, matches: s.matchesReference });
      if (!s.matchesReference) {
        dv.anyMismatch = true;
        if (f.key === 'name') dv.nameMismatch = true;
      }
    }
  }
  // Worst first: different name, then other detail mismatches, then matches.
  const rank = (d: DocView) => (d.nameMismatch ? 0 : d.anyMismatch ? 1 : 2);
  return [...map.values()].sort(
    (a, b) => rank(a) - rank(b) || a.documentName.localeCompare(b.documentName),
  );
}

export function IdentityReconciliationPanel({ caseId }: { caseId: string }) {
  const [data, setData] = useState<ApiIdentityReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [showFields, setShowFields] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchIdentityReconciliation(caseId)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setOpen(r.overall === 'review'); // auto-expand only when there's something to review
      })
      .catch(() => {
        /* best-effort panel */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const docViews = useMemo(() => (data ? buildDocViews(data) : []), [data]);

  if (loading || !data) return null;

  const meta = OVERALL[data.overall];
  const Icon = meta.icon;
  const mismatchCount = docViews.filter((d) => d.anyMismatch).length;
  const clientName = data.client.name ?? 'this client';

  const crmChips: Array<[string, string]> = [];
  if (data.client.name) crmChips.push(['Name', data.client.name]);
  if (data.client.dateOfBirth) crmChips.push(['Date of birth', data.client.dateOfBirth]);
  if (data.client.passportNumber) crmChips.push(['Passport #', data.client.passportNumber]);
  if (data.client.nationalId) crmChips.push(['CNIC', data.client.nationalId]);

  return (
    <GlassCard variant="panel" padded="md">
      {/* header / toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          color: 'var(--sos-text-primary)',
        }}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Icon size={15} style={{ color: 'var(--sos-text-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Identity check</span>
        <StatusBadge tone={meta.tone} size="sm">{meta.label}</StatusBadge>
        <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
          {data.documentCount} document{data.documentCount === 1 ? '' : 's'} checked
        </span>
      </button>

      {open && data.overall === 'insufficient' ? (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sos-text-muted)' }}>
          No identity details have been read from this case&apos;s documents yet. They appear here
          once a passport, CNIC, or similar document has been processed.
        </div>
      ) : null}

      {open && data.overall !== 'insufficient' ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 1 — plain-English verdict */}
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--sos-text-secondary)' }}>
            {data.overall === 'ok' ? (
              <>
                All <strong>{data.documentCount}</strong> documents agree this is{' '}
                <strong style={{ color: 'var(--sos-text-primary)' }}>{clientName}</strong>.
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--sos-status-warning)' }}>{mismatchCount}</strong> of{' '}
                <strong>{data.documentCount}</strong> documents don&apos;t match{' '}
                <strong style={{ color: 'var(--sos-text-primary)' }}>{clientName}</strong>. Check the
                flagged ones before accepting &mdash; they may belong to someone else or be the wrong
                file.
              </>
            )}
          </div>

          {/* 2 — who we're checking against */}
          {crmChips.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--sos-text-muted)',
                }}
              >
                On file
              </span>
              {crmChips.map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    fontSize: 11.5,
                    padding: '2px 8px',
                    borderRadius: 'var(--sos-radius-sm)',
                    background: 'var(--sos-surface)',
                    border: '1px solid var(--sos-border-subtle)',
                    color: 'var(--sos-text-muted)',
                  }}
                >
                  {k}: <strong style={{ color: 'var(--sos-text-primary)' }}>{v}</strong>
                </span>
              ))}
            </div>
          ) : null}

          {/* 3 — per-document verdicts (the at-a-glance answer) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docViews.map((d) => {
              const matchedLabels = d.cells.filter((c) => c.matches).map((c) => c.label);
              const offCells = d.cells.filter((c) => !c.matches);
              const tone: BadgeTone = d.anyMismatch ? 'warning' : 'success';
              const verdict = !d.anyMismatch
                ? 'Matches'
                : d.nameMismatch
                  ? 'Different name'
                  : 'Check detail';
              return (
                <div
                  key={d.itemId}
                  style={{
                    display: 'flex',
                    gap: 9,
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    borderRadius: 'var(--sos-radius-md)',
                    background: 'var(--sos-surface-hover)',
                    border: '1px solid var(--sos-border-subtle)',
                    borderLeft: `3px solid ${
                      d.anyMismatch ? 'var(--sos-status-warning)' : 'var(--sos-status-success)'
                    }`,
                  }}
                >
                  <span style={{ marginTop: 1, flexShrink: 0 }}>
                    {d.anyMismatch ? (
                      <AlertTriangle size={14} style={{ color: 'var(--sos-status-warning)' }} />
                    ) : (
                      <Check size={14} style={{ color: 'var(--sos-status-success)' }} />
                    )}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                        {d.documentName}
                      </span>
                      <StatusBadge tone={tone} size="sm">{verdict}</StatusBadge>
                    </div>
                    {d.anyMismatch ? (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--sos-text-muted)',
                          marginTop: 3,
                          lineHeight: 1.5,
                        }}
                      >
                        {offCells.map((c, i) => (
                          <span key={c.label}>
                            {i > 0 ? ' · ' : ''}
                            {c.label}:{' '}
                            <strong style={{ color: 'var(--sos-status-warning)' }}>{c.value}</strong>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginTop: 3 }}>
                        Confirmed{matchedLabels.length ? `: ${matchedLabels.join(', ')}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 4 — field-by-field detail (collapsible; for same-person-detail-differs cases) */}
          <div>
            <button
              type="button"
              onClick={() => setShowFields((s) => !s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11.5,
                color: 'var(--sos-text-muted)',
              }}
            >
              {showFields ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Field-by-field comparison
            </button>
            {showFields ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.fields
                  .filter((f) => f.sources.length > 0 || f.crmValue)
                  .map((f) => (
                    <div
                      key={f.key}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--sos-radius-md)',
                        border: '1px solid var(--sos-border-subtle)',
                        background: 'var(--sos-surface-hover)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                          {f.label}
                        </span>
                        {f.status === 'conflict' ? (
                          <StatusBadge tone="warning" size="sm">conflict</StatusBadge>
                        ) : f.status === 'agree' ? (
                          <StatusBadge tone="success" size="sm">agree</StatusBadge>
                        ) : null}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>
                          On file: <strong style={{ color: 'var(--sos-text-secondary)' }}>{f.crmValue ?? '—'}</strong>
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {f.sources.length === 0 ? (
                          <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                            No document provided this.
                          </span>
                        ) : (
                          f.sources.map((s) => (
                            <span
                              key={s.itemId}
                              title={s.documentName}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '3px 8px',
                                borderRadius: 'var(--sos-radius-sm)',
                                fontSize: 11.5,
                                border: `1px solid ${
                                  s.matchesReference
                                    ? 'var(--sos-border-subtle)'
                                    : 'var(--sos-status-warning)'
                                }`,
                                background: 'var(--sos-surface)',
                                color: 'var(--sos-text-secondary)',
                              }}
                            >
                              {s.matchesReference ? (
                                <Check size={12} style={{ color: 'var(--sos-status-success)' }} />
                              ) : (
                                <X size={12} style={{ color: 'var(--sos-status-warning)' }} />
                              )}
                              <span style={{ color: 'var(--sos-text-muted)' }}>{s.documentName}:</span>
                              <strong style={{ color: 'var(--sos-text-primary)' }}>{s.value}</strong>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>

          {/* 5 — footer */}
          <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', lineHeight: 1.5 }}>
            Flags only &mdash; you decide. Spelling differences between Urdu and English (e.g. Pervaiz /
            Parvez) are normal and don&apos;t count as a mismatch; identity is never auto-rejected.
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}
