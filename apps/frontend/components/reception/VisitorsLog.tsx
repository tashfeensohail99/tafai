'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, Search, Users } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  GlassCard,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  listVisits,
  type VisitList,
  type VisitRow,
  type VisitStatus,
  type VisitType,
} from '@/lib/reception-api';
import { fmtDuration, fmtTime, STATUS_LABEL, STATUS_TONE, td, th, TYPE_META } from './shared';

const PAGE = 25;

/** Consultation-fee status for the log's Payment column. Only paid consults
 *  carry a fee; other visit types show a dash. */
function paymentBadge(v: VisitRow) {
  if (v.visitType !== 'PAID_CONSULT') return <span className="sos-text-faint" style={{ fontSize: 12 }}>—</span>;
  if (v.paid) return <StatusBadge tone="success" size="sm" dot>Fee paid</StatusBadge>;
  if (v.pendingPayment) return <StatusBadge tone="warning" size="sm" dot>Verifying</StatusBadge>;
  return <StatusBadge tone="neutral" size="sm" dot>Fee due</StatusBadge>;
}

function pktDateMinus(days: number): string {
  const p = new Date(Date.now() + 5 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
}
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Karachi' }).format(new Date(iso));
}

const STATUS_OPTS = (Object.keys(STATUS_LABEL) as VisitStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }));
const TYPE_OPTS = (Object.keys(TYPE_META) as VisitType[]).map((t) => ({ value: t, label: TYPE_META[t].label }));

export function VisitorsLog() {
  // Default window frozen at mount, so the "Reset" affordance and the reset
  // action compare against a stable baseline (not a value that shifts at PKT
  // midnight).
  const [defFrom] = useState(() => pktDateMinus(6));
  const [defTo] = useState(() => pktDateMinus(0));

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(defTo);
  const [status, setStatus] = useState<VisitStatus | ''>('');
  const [type, setType] = useState<VisitType | ''>('');
  const [page, setPage] = useState(0);

  const [data, setData] = useState<VisitList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may write state — a filter change fires a fetch at
  // the old page before setPage(0) lands, and this stops that stale response
  // from clobbering the correct page-0 data.
  const reqSeq = useRef(0);

  // Debounce the free-text search only.
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [dq, from, to, status, type]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const seq = ++reqSeq.current;
    try {
      const res = await listVisits({
        from,
        to,
        q: dq || undefined,
        status: status || undefined,
        type: type || undefined,
        limit: PAGE,
        offset: page * PAGE,
      });
      if (seq === reqSeq.current) setData(res);
    } catch (e) {
      if (seq === reqSeq.current) setError(e instanceof Error ? e.message : 'Failed to load the visitor log');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [from, to, dq, status, type, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = data?.visits ?? [];
  const total = data?.total ?? 0;
  const offset = page * PAGE;
  const anyFilter = !!dq || !!status || !!type || from !== defFrom || to !== defTo;

  const reset = () => {
    setQ('');
    setDq('');
    setFrom(defFrom);
    setTo(defTo);
    setStatus('');
    setType('');
    setPage(0);
  };

  const counts = data?.counts;
  const summary = useMemo(
    () =>
      counts
        ? `${counts.walkIn} walk-in · ${counts.existing} client · ${counts.paid} paid · ${counts.noShow} no-show`
        : '',
    [counts],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <GlassCard variant="soft" padded="md">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <FormInput
              placeholder="Search by name or phone…"
              iconLeft={<Search size={15} />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="sos-input" /></Field>
          <Field label="To"><input type="date" value={to} min={from} max={pktDateMinus(0)} onChange={(e) => setTo(e.target.value)} className="sos-input" /></Field>
          <FormSelect label="Type" value={type} onChange={(e) => setType(e.target.value as VisitType | '')} placeholder="All types" options={TYPE_OPTS} />
          <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value as VisitStatus | '')} placeholder="All statuses" options={STATUS_OPTS} />
        </div>
        {anyFilter ? (
          <div style={{ marginTop: 10 }}>
            <GhostButton size="sm" iconLeft={<RotateCcw size={14} />} onClick={reset}>Reset filters</GhostButton>
          </div>
        ) : null}
      </GlassCard>

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      {/* Results */}
      <GlassCard variant="default" padded={false} glow="accent">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Users size={16} style={{ color: 'var(--sos-brand-accent)' }} />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Visitor log</h2>
          {summary ? <span className="sos-text-faint" style={{ fontSize: 12 }}>{summary}</span> : null}
          <span style={{ marginLeft: 'auto' }}>
            <StatusBadge tone="neutral" size="sm" dot={false}>{loading ? '…' : `${total} total`}</StatusBadge>
          </span>
        </div>

        {loading ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="sos-text-faint" style={{ padding: 28, textAlign: 'center', fontSize: 13 }}>No visitors match these filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>In</th>
                  <th style={th}>Visitor</th>
                  <th style={th}>Type</th>
                  <th style={th}>Purpose</th>
                  <th style={th}>Host</th>
                  <th style={th}>Status</th>
                  <th style={th}>Payment</th>
                  <th style={th}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(v.checkedInAt)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(v.checkedInAt)}</td>
                    <td style={td}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{v.name}</div>
                      <div className="sos-text-faint" style={{ fontSize: 11.5 }}>{v.referenceCode ? `${v.referenceCode} · ` : ''}{v.phone ?? 'no phone'}</div>
                    </td>
                    <td style={td}><StatusBadge tone={TYPE_META[v.visitType].tone} size="sm" dot={false}>{TYPE_META[v.visitType].label}</StatusBadge></td>
                    <td style={{ ...td, maxWidth: 200, whiteSpace: 'normal' }}>{v.purpose ?? '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.hostName ?? '—'}</td>
                    <td style={td}><StatusBadge tone={STATUS_TONE[v.status]} size="sm" dot>{STATUS_LABEL[v.status]}</StatusBadge></td>
                    <td style={td}>{paymentBadge(v)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.checkedOutAt ? fmtDuration(v.checkedInAt, v.checkedOutAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 0 ? (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="sos-text-faint" style={{ fontSize: 12 }}>
              {rows.length === 0 ? '0' : `${offset + 1}–${offset + rows.length}`} of {total}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <GhostButton size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))} iconLeft={<ChevronLeft size={14} />}>Prev</GhostButton>
              <GhostButton size="sm" disabled={offset + rows.length >= total || loading} onClick={() => setPage((p) => p + 1)} iconRight={<ChevronRight size={14} />}>Next</GhostButton>
            </span>
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
}
