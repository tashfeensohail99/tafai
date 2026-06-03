'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Loader2,
  Search,
  X,
  MessageCircle,
  Mail,
  Phone,
  ArrowUpRight,
  FileText,
  AlertTriangle,
  Send,
  Check,
} from 'lucide-react';
import { STAGE_LABEL, PRIORITY_LABEL, fmtRelative } from '@/components/processing/mockData';
import { stageTone, priorityTone } from '@/components/processing/ProcessingDashboardPage';
import { StatusBadge, GlassCard, PrimaryButton, SecondaryButton } from '@/components/sales-v2/ui';
import {
  fetchProcessingCases,
  sendCaseCommunication,
  casePersonName,
  type ApiProcessingCaseListItem,
  type ProcessingStage,
  type ProcessingPriority,
  type ListCasesQuery,
} from '@/lib/processing';
import { SERVICE_TYPES, labelForServiceCode } from '@/lib/service-types';

/**
 * Active processing cases — all stages except COMPLETED and CANCELLED.
 * Redesigned as a dense, at-a-glance roster: each row shows who/what/where, the
 * stage + SLA health, document progress, and inline quick actions (CRM
 * WhatsApp, logged email, call, open) so the team can act without opening the
 * full case. Filters (duration, case type, officer, last activity) are kept.
 */

const STAGES: ProcessingStage[] = [
  'INTAKE_PENDING',
  'DOCUMENTS_COLLECTION',
  'DOCUMENTS_UNDER_REVIEW',
  'DOCUMENTS_INCOMPLETE',
  'DOCUMENTS_COMPLETE',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'UNDER_AUTHORITY_REVIEW',
  'ADDITIONAL_INFO_REQUESTED',
  'DECISION_RECEIVED',
  'APPROVED',
  'REJECTED',
  'APPEAL_IN_PROGRESS',
];

const PRIORITIES: ProcessingPriority[] = ['CRITICAL', 'URGENT', 'NORMAL', 'LOW'];

const GRID = 'minmax(230px, 2.3fr) minmax(190px, 1.6fr) minmax(150px, 1.2fr) minmax(120px, 1fr) 188px';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function digitsOnly(phone: string): string {
  return (phone || '').replace(/[^\d]/g, '');
}

function isPlaceholderPhone(phone: string): boolean {
  return !phone || phone.startsWith('MANUAL-');
}

type SlaTone = 'danger' | 'warning' | 'muted';
function slaInfo(slaDueAt: string | null): { label: string; tone: SlaTone } | null {
  if (!slaDueAt) return null;
  const ms = new Date(slaDueAt).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (ms < 0) {
    const od = Math.abs(days);
    return { label: od <= 0 ? 'Overdue' : `Overdue ${od}d`, tone: 'danger' };
  }
  if (days <= 0) return { label: 'Due today', tone: 'warning' };
  if (days <= 3) return { label: `Due in ${days}d`, tone: 'warning' };
  return { label: `Due in ${days}d`, tone: 'muted' };
}

const SLA_COLORS: Record<SlaTone, { bg: string; fg: string }> = {
  danger: { bg: 'rgba(220,38,38,0.12)', fg: 'var(--sos-status-danger)' },
  warning: { bg: 'rgba(217,119,6,0.12)', fg: 'var(--sos-status-warning)' },
  muted: { bg: 'var(--sos-surface-2)', fg: 'var(--sos-text-muted)' },
};

// ---------------------------------------------------------------------------
// Inline email composer — sends a logged email through the case (no need to
// open the case). Reuses POST /processing/cases/:id/communications (EMAIL).
// ---------------------------------------------------------------------------
function EmailComposeModal({
  caseItem,
  onClose,
}: {
  caseItem: ApiProcessingCaseListItem;
  onClose: () => void;
}) {
  const name = casePersonName(caseItem);
  const email = caseItem.client.email ?? caseItem.lead.email ?? '';
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ warnings: string[] } | null>(null);

  const canSend = subject.trim().length > 0 && content.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setErr(null);
    try {
      const res = await sendCaseCommunication(caseItem.id, {
        subject: subject.trim(),
        content: content.trim(),
        channelsSent: ['EMAIL'],
      });
      setDone({ warnings: res.deliveryWarnings ?? [] });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to send email');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        backdropFilter: 'blur(2px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: 'var(--sos-surface-1)',
          border: '1px solid var(--sos-border-subtle)',
          borderRadius: 'var(--sos-radius-lg)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--sos-brand-primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sos-brand-primary-strong)' }}>
              <Mail size={17} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Email {name}</div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{email || 'No email on file'}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div style={{ marginTop: 18, textAlign: 'center', padding: '12px 0' }}>
            <Check size={36} style={{ color: 'var(--sos-status-success)', marginBottom: 8 }} />
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Email sent</div>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 4 }}>
              Sent to <strong>{email}</strong> and logged on the case.
            </div>
            {done.warnings.length > 0 ? (
              <div className="sos-banner sos-banner--warning" style={{ marginTop: 12, textAlign: 'left' }}>
                {done.warnings.join(' · ')}
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <SecondaryButton onClick={onClose}>Close</SecondaryButton>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="sos-label">Subject</label>
              <input
                className="sos-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Update on your application"
                maxLength={200}
              />
            </div>
            <div>
              <label className="sos-label">Message</label>
              <textarea
                className="sos-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your message to the client…"
                rows={6}
              />
            </div>
            {err ? <div className="sos-banner sos-banner--danger">{err}</div> : null}
            {!email ? (
              <div className="sos-banner sos-banner--warning">This client has no email on file.</div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <SecondaryButton onClick={onClose} disabled={sending}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={send}
                disabled={!canSend || !email}
                iconLeft={sending ? <Loader2 size={14} className="sos-spin" /> : <Send size={14} />}
              >
                {sending ? 'Sending…' : 'Send email'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small round icon action button
// ---------------------------------------------------------------------------
function ActionIcon({
  title,
  onClick,
  href,
  external,
  disabled,
  color,
  children,
}: {
  title: string;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  disabled?: boolean;
  color?: string;
  children: ReactNode;
}) {
  const base: CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--sos-border-subtle)',
    background: 'var(--sos-surface-1)',
    color: disabled ? 'var(--sos-text-disabled, #cbd5e1)' : color ?? 'var(--sos-text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    transition: 'all 120ms',
  };
  if (href && !disabled) {
    // tel:/external links use a plain anchor; internal routes use Next Link
    // for client-side navigation.
    if (external) {
      return (
        <a href={href} title={title} style={base} aria-label={title}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href as Route} title={title} style={base} aria-label={title}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} style={base} aria-label={title}>
      {children}
    </button>
  );
}

function DocProgress({ p }: { p: ApiProcessingCaseListItem['docProgress'] }) {
  if (!p || p.total === 0) {
    return <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>Not started</span>;
  }
  const pct = Math.round((p.verified / p.total) * 100);
  const complete = p.verified >= p.total;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sos-text-secondary)' }}>
        <FileText size={12} style={{ color: 'var(--sos-text-muted)' }} />
        <span style={{ fontWeight: 600 }}>{p.verified}/{p.total}</span>
        <span style={{ color: 'var(--sos-text-muted)' }}>verified</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: 'var(--sos-surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: complete ? 'var(--sos-status-success)' : 'var(--sos-brand-primary)', transition: 'width 200ms' }} />
      </div>
      {p.criticalMissing > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--sos-status-danger)', fontWeight: 600 }}>
          <AlertTriangle size={11} /> {p.criticalMissing} critical missing
        </div>
      ) : null}
    </div>
  );
}

export default function CasesPage() {
  const [cases, setCases] = useState<ApiProcessingCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<ApiProcessingCaseListItem | null>(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stage, setStage] = useState<ProcessingStage | ''>('');
  const [priority, setPriority] = useState<ProcessingPriority | ''>('');
  const [service, setService] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [updatedFrom, setUpdatedFrom] = useState('');
  const [updatedTo, setUpdatedTo] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const query: ListCasesQuery = useMemo(
    () => ({
      limit: 200,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(stage ? { stage } : {}),
      ...(priority ? { priority } : {}),
      ...(service ? { service } : {}),
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
      ...(updatedFrom ? { updatedFrom } : {}),
      ...(updatedTo ? { updatedTo } : {}),
    }),
    [debouncedSearch, stage, priority, service, createdFrom, createdTo, updatedFrom, updatedTo],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProcessingCases(query)
      .then((res) => {
        if (cancelled) return;
        setCases(res.cases.filter((c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED'));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load cases');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const hasActiveFilters = !!(stage || priority || service || createdFrom || createdTo || updatedFrom || updatedTo || debouncedSearch);

  function clearAll() {
    setSearch('');
    setStage('');
    setPriority('');
    setService('');
    setCreatedFrom('');
    setCreatedTo('');
    setUpdatedFrom('');
    setUpdatedTo('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Filter row */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)' }}>
            <Search size={14} style={{ color: 'var(--sos-text-muted)' }} />
            <input
              type="search"
              placeholder="Search by client name or case id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 13.5 }}
            />
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearAll}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid var(--sos-border-subtle)', borderRadius: 6, background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 11.5, cursor: 'pointer' }}
              >
                <X size={11} /> Clear filters
              </button>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <select className="sos-input" value={stage} onChange={(e) => setStage(e.target.value as ProcessingStage | '')}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </select>
            <select className="sos-input" value={priority} onChange={(e) => setPriority(e.target.value as ProcessingPriority | '')}>
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
            <select className="sos-input" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">All service types</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Intake date</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="sos-input" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
                <input className="sos-input" type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Last activity</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="sos-input" type="date" value={updatedFrom} onChange={(e) => setUpdatedFrom(e.target.value)} />
                <input className="sos-input" type="date" value={updatedTo} onChange={(e) => setUpdatedTo(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
        Active cases ({cases.length}){hasActiveFilters ? ' · filtered' : ''}
      </div>

      <GlassCard variant="panel" padded={false}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '9px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <span>Client / Case</span>
              <span>Contact</span>
              <span>Stage / SLA</span>
              <span>Documents</span>
              <span style={{ textAlign: 'right' }}>Quick actions</span>
            </div>

            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Loader2 size={14} className="sos-spin" /> Loading…
              </div>
            ) : error ? (
              <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load cases: {error}</div>
            ) : cases.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
                {hasActiveFilters ? 'No cases match these filters.' : 'No active processing cases yet. Cases appear here once Finance hands them off.'}
              </div>
            ) : (
              cases.map((c) => {
                const name = casePersonName(c);
                const phone = c.client.phone || c.lead.phone || '';
                const email = c.client.email ?? c.lead.email ?? '';
                const placeholderPhone = isPlaceholderPhone(phone);
                const sla = slaInfo(c.slaDueAt);
                const isManual = c.lead.sourceChannel === 'PROCESSING_MANUAL';
                return (
                  <div
                    key={c.id}
                    style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '13px 16px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', transition: 'background 150ms' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Client / Case */}
                    <div style={{ display: 'flex', gap: 11, alignItems: 'center', minWidth: 0 }}>
                      <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '50%', background: 'var(--sos-brand-primary-soft)', color: 'var(--sos-brand-primary-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                        {initials(name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Link href={`/processing/cases/${c.id}` as Route} style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {name}
                          </Link>
                          {isManual ? (
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--sos-brand-primary-strong)', background: 'var(--sos-brand-primary-soft)', padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Manual</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.lead.referenceCode} · {labelForServiceCode(c.service)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Pakistan → {c.targetCountry}</div>
                      </div>
                    </div>

                    {/* Contact */}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: placeholderPhone ? 'var(--sos-text-muted)' : 'var(--sos-text-secondary)' }}>
                        <Phone size={11} style={{ flexShrink: 0, color: 'var(--sos-text-muted)' }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{placeholderPhone ? 'No phone' : phone}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: email ? 'var(--sos-text-secondary)' : 'var(--sos-text-muted)' }}>
                        <Mail size={11} style={{ flexShrink: 0, color: 'var(--sos-text-muted)' }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email || 'No email'}</span>
                      </div>
                    </div>

                    {/* Stage / SLA */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                      <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
                        {sla ? (
                          <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: SLA_COLORS[sla.tone].bg, color: SLA_COLORS[sla.tone].fg }}>
                            {sla.label}
                          </span>
                        ) : null}
                      </div>
                      <span style={{ fontSize: 10.5, color: 'var(--sos-text-muted)' }}>{fmtRelative(c.updatedAt)}</span>
                    </div>

                    {/* Documents */}
                    <DocProgress p={c.docProgress} />

                    {/* Quick actions */}
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <ActionIcon
                        title={placeholderPhone ? 'No phone number on file' : 'Open CRM WhatsApp chat'}
                        href={`/processing/cases/${c.id}?tab=whatsapp`}
                        disabled={placeholderPhone}
                        color="#16a34a"
                      >
                        <MessageCircle size={15} />
                      </ActionIcon>
                      <ActionIcon
                        title={email ? `Email ${name}` : 'No email on file'}
                        onClick={() => setEmailFor(c)}
                        disabled={!email}
                        color="var(--sos-brand-primary)"
                      >
                        <Mail size={15} />
                      </ActionIcon>
                      <ActionIcon
                        title={placeholderPhone ? 'No phone number on file' : `Call ${phone}`}
                        href={placeholderPhone ? undefined : `tel:${digitsOnly(phone)}`}
                        external
                        disabled={placeholderPhone}
                      >
                        <Phone size={15} />
                      </ActionIcon>
                      <ActionIcon title="Open case" href={`/processing/cases/${c.id}`} color="var(--sos-brand-primary-strong)">
                        <ArrowUpRight size={15} />
                      </ActionIcon>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </GlassCard>

      {emailFor ? <EmailComposeModal caseItem={emailFor} onClose={() => setEmailFor(null)} /> : null}
    </div>
  );
}
