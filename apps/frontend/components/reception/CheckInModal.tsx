'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Loader2, Search, Star, UserPlus, Users, X } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  createVisit,
  receptionLookup,
  type Host,
  type LookupHit,
  type ReceptionSettings,
} from '@/lib/reception-api';
import { avatarStyle, initials } from './shared';

type Tab = 'existing' | 'walkin' | 'paid';

const TABS: Array<{ key: Tab; label: string; Icon: typeof Users }> = [
  { key: 'existing', label: 'Existing', Icon: Users },
  { key: 'walkin', label: 'Walk-in', Icon: UserPlus },
  { key: 'paid', label: 'Paid consult', Icon: Star },
];

export function CheckInModal({
  open,
  hosts,
  settings,
  onClose,
  onDone,
}: {
  open: boolean;
  hosts: Host[];
  settings: ReceptionSettings | null;
  onClose: () => void;
  onDone: () => void;
}) {
  // Paid consultations are ALWAYS with the principal (the one configured
  // consultant, e.g. Mr. Tashfeen) — not a rep the desk picks. If none is set,
  // the paid tab is blocked with a hint to configure it in Reception Settings.
  const principal = settings?.principal ?? null;
  const [tab, setTab] = useState<Tab>('existing');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LookupHit | null>(null);
  const lookupSeq = useRef(0);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hostId, setHostId] = useState('');
  const [purpose, setPurpose] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTab('existing');
    setQuery('');
    setHits([]);
    setSelected(null);
    setName('');
    setPhone('');
    setHostId('');
    setPurpose('');
    setError(null);
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Debounced lookup with out-of-order guard.
  useEffect(() => {
    if (!open || tab !== 'existing') return;
    const term = query.trim();
    if (term.length < 2) {
      lookupSeq.current++; // invalidate any longer-query response still in flight
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++lookupSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await receptionLookup(term);
        if (seq === lookupSeq.current) setHits(res.results);
      } catch {
        if (seq === lookupSeq.current) setHits([]);
      } finally {
        if (seq === lookupSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, open, tab]);

  if (!open) return null;

  // A real (selectable) empty option so the desk can go back to "Any" — a
  // FormSelect placeholder renders as a DISABLED option and would trap the value.
  const hostOptions = [
    { value: '', label: 'Any / front desk' },
    ...hosts.map((h) => ({ value: h.id, label: h.department ? `${h.name} · ${h.department}` : h.name })),
  ];

  const canSubmit =
    !submitting &&
    (tab === 'existing'
      ? !!selected
      : tab === 'walkin'
        ? name.trim().length > 0 && phone.trim().length > 0
        : name.trim().length > 0 && !!principal); // paid needs a configured principal

  const cta = tab === 'existing' ? 'Check in' : tab === 'walkin' ? 'Add walk-in' : 'Log paid visit';

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const common = {
        hostEmployeeId: hostId || undefined,
        purpose: purpose.trim() || undefined,
      };
      if (tab === 'existing') {
        if (!selected) return;
        await createVisit({
          visitType: 'EXISTING_CLIENT',
          name: selected.name,
          phone: selected.phone ?? undefined,
          leadId: selected.kind === 'lead' ? selected.id : undefined,
          clientId: selected.kind === 'client' ? selected.id : undefined,
          ...common,
        });
      } else if (tab === 'walkin') {
        await createVisit({ visitType: 'WALK_IN', name: name.trim(), phone: phone.trim() || undefined, ...common });
      } else {
        await createVisit({ visitType: 'PAID_CONSULT', name: name.trim(), phone: phone.trim() || undefined, ...common });
      }
      onDone();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check in this visitor');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Check in a visitor"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--sos-bg-overlay)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: 560, borderRadius: 'var(--sos-radius-panel, 20px)', padding: 0 }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 18px',
            borderBottom: '1px solid var(--sos-border-subtle)',
          }}
        >
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>Check in a visitor</div>
          <button type="button" onClick={close} aria-label="Close" className="sos-btn sos-btn--ghost sos-btn--sm">
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setError(null);
                  }}
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    borderRadius: 10,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                    background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                    color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
                  }}
                >
                  <t.Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>

          {/* Existing lookup */}
          {tab === 'existing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FormInput
                label="Find them in the CRM"
                placeholder="Search by phone or name…"
                iconLeft={<Search size={15} />}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
              />
              {searching ? (
                <div className="sos-text-faint" style={{ fontSize: 12 }}>
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Searching…
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 210, overflowY: 'auto' }}>
                {hits.map((h) => {
                  const active = selected?.kind === h.kind && selected?.id === h.id;
                  return (
                    <button
                      key={`${h.kind}-${h.id}`}
                      type="button"
                      onClick={() => setSelected(h)}
                      style={{
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                        background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                      }}
                    >
                      <div style={avatarStyle(32)}>{initials(h.name)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{h.name}</div>
                        <div className="sos-text-faint" style={{ fontSize: 11.5 }}>
                          {h.referenceCode} · {h.phone ?? 'no phone'}{h.owner ? ` · ${h.owner}` : ''}
                        </div>
                      </div>
                      <StatusBadge tone={h.kind === 'client' ? 'success' : 'neutral'} size="sm" dot={false}>
                        {h.kind === 'client' ? 'Client' : 'Lead'}
                      </StatusBadge>
                      {active ? <Check size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} /> : null}
                    </button>
                  );
                })}
                {query.trim().length >= 2 && !searching && hits.length === 0 ? (
                  <div className="sos-text-faint" style={{ fontSize: 12 }}>
                    No match — switch to “Walk-in” to add them as a new lead.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            /* Manual entry (walk-in / paid) */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormInput label="Full name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Visitor name" />
              <FormInput
                label={tab === 'walkin' ? 'Phone (required)' : 'Phone'}
                required={tab === 'walkin'}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="03xx xxxxxxx"
              />
            </div>
          )}

          {tab === 'paid' ? (
            principal ? (
              <div className="sos-banner" style={{ fontSize: 12 }}>
                Paid consultation is with <strong>{principal.name}</strong>
                {settings?.feeAmount
                  ? ` · fee ${settings.feeCurrency ?? ''} ${settings.feeAmount.toLocaleString()}`
                  : ''}
                . Collect the fee from the lobby once they’re logged in.
              </div>
            ) : (
              <div className="sos-banner sos-banner--danger" style={{ fontSize: 12 }}>
                No paid-consultation consultant is set. Configure one in Admin → Reception Settings
                before logging a paid consult.
              </div>
            )
          ) : null}

          {/* Common: host + reason. A PAID consult is always with the principal,
              so the host is fixed on that tab (not a free pick). */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {tab === 'paid' ? (
              <Field label="Consultation with">
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--sos-border-subtle)',
                    background: 'var(--sos-surface-2)',
                    color: 'var(--sos-text-secondary)',
                    fontSize: 13,
                    minHeight: 20,
                  }}
                >
                  {principal ? principal.name : '—'}
                </div>
              </Field>
            ) : (
              <FormSelect
                label="Here to see"
                value={hostId}
                onChange={(e) => setHostId(e.target.value)}
                options={hostOptions}
              />
            )}
            <Field label="Reason">
              <FormInput value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. document pickup" />
            </Field>
          </div>

          {error ? <div className="sos-banner sos-banner--danger" style={{ fontSize: 12.5 }}>{error}</div> : null}
        </div>

        <footer style={footerStyle}>
          <GhostButton type="button" onClick={close} disabled={submitting}>Cancel</GhostButton>
          <PrimaryButton
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            iconLeft={submitting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={15} />}
          >
            {cta}
          </PrimaryButton>
        </footer>
      </div>
    </div>
  );
}

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  padding: '14px 18px',
  borderTop: '1px solid var(--sos-border-subtle)',
};
