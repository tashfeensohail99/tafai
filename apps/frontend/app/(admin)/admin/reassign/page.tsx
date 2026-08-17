'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRightLeft,
  ChevronDown,
  Clock,
  FileText,
  History,
  Loader2,
  Lock,
  MessageSquare,
  Search,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  FormInput,
  FormSelect,
  GhostButton,
  GlassCard,
  PageHeader,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import { apiFetch } from '@/lib/api-client';
import { WhatsAppLeadTab } from '@/components/whatsapp/WhatsAppLeadTab';
import { LeadActivityTimeline } from '@/components/shared/LeadActivityTimeline';
import { LeadAgreementSummary } from '@/components/shared/LeadAgreementSummary';

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface AdminSearchRow {
  // 'lead' = the record is a Lead row (normal reassign flow).
  // 'client' = ORPHAN client (no source lead); reassign is disabled and the
  // admin is told this lives in a different flow.
  type: 'lead' | 'client';
  id: string;
  name: string;
  clientName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  source: string | null;
  isDeleted: boolean;
  // Converted lead -- reassigning it in isolation would leave the client on
  // its old rep, which is what actually drives Telenor routing / ownership.
  isConverted: boolean;
  // Populated when isConverted -- the client's OWN phone (may differ from the
  // lead's phone if updated post-conversion) and current rep. Both surface in
  // the expanded-row warning so the admin sees why the reassign is blocked.
  convertedClientPhone: string | null;
  convertedClientAssignedEmployeeName: string | null;
  createdAt: string;
  updatedAt: string;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
}

interface AdminSearchResponse {
  items: AdminSearchRow[];
  truncated: boolean;
  sources: string[];
}

interface HistoryEntry {
  id: string;
  at: string;
  toEmployeeName: string | null;
  description: string | null;
}

const LEAD_STATUSES: Array<[string, string]> = [
  ['NEW', 'New'],
  ['CONTACTED', 'Contacted'],
  ['QUALIFIED', 'Qualified'],
  ['PROPOSAL_SENT', 'Proposal sent'],
  ['FOLLOW_UP', 'Follow up'],
  ['CONVERTED', 'Converted'],
  ['LOST', 'Lost'],
  ['DUPLICATE', 'Duplicate'],
  ['UNQUALIFIED', 'Unqualified'],
];

const STATUS_TONE: Record<string, BadgeTone> = {
  NEW: 'info',
  CONTACTED: 'accent',
  QUALIFIED: 'cyan',
  PROPOSAL_SENT: 'violet',
  FOLLOW_UP: 'warning',
  CONVERTED: 'success',
  LOST: 'danger',
  DUPLICATE: 'neutral',
  UNQUALIFIED: 'neutral',
};

function statusLabel(status: string): string {
  return LEAD_STATUSES.find(([v]) => v === status)?.[1] ?? status.replace(/_/g, ' ').toLowerCase();
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Debounce so typing in the search box doesn't fire a request per key. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--sos-text-faint)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  color: 'var(--sos-text-secondary)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  verticalAlign: 'middle',
};

export default function ReassignPage() {
  const { user } = useAdminSession();
  const canAssign = user.permissions.includes('leads.assign');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [deleted, setDeleted] = useState<'include' | 'exclude' | 'only'>('exclude');

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [rows, setRows] = useState<AdminSearchRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debQ = useDebounced(q, 300);

  // Load the rep roster once — populates both the rep filter and the reassign
  // dropdown. limit=1000 so the full sales floor is present, not the first page.
  useEffect(() => {
    if (!canAssign) return;
    apiFetch<EmployeeOption[]>('/employees?limit=1000')
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [canAssign]);

  const runSearch = useMemo(
    () =>
      async (signal?: { cancelled: boolean }) => {
        const params = new URLSearchParams();
        if (debQ.trim().length >= 2) params.set('q', debQ.trim());
        if (status) params.set('status', status);
        if (source) params.set('source', source);
        if (repFilter) params.set('assignedEmployeeId', repFilter);
        params.set('deleted', deleted);

        // Nothing to search on yet — a bare page with no term and no filter.
        const hasCriteria =
          debQ.trim().length >= 2 || !!status || !!source || !!repFilter || deleted === 'only';
        if (!hasCriteria) {
          setRows([]);
          setTruncated(false);
          return;
        }

        setLoading(true);
        setError(null);
        try {
          const res = await apiFetch<AdminSearchResponse>(`/leads/admin-search?${params.toString()}`);
          if (signal?.cancelled) return;
          setRows(res.items);
          setTruncated(res.truncated);
          // The source list is stable; keep the first non-empty one we see so the
          // dropdown stays populated even after a filter narrows the results.
          if (res.sources.length) setSources(res.sources);
        } catch (e) {
          if (!signal?.cancelled) setError(e instanceof Error ? e.message : 'Search failed');
        } finally {
          if (!signal?.cancelled) setLoading(false);
        }
      },
    [debQ, status, source, repFilter, deleted],
  );

  useEffect(() => {
    if (!canAssign) return;
    const signal = { cancelled: false };
    void runSearch(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [runSearch, canAssign]);

  function reload() {
    void runSearch();
  }

  if (!canAssign) {
    return <PermissionDeniedState message="You need the leads.assign permission to search and reassign leads." />;
  }

  const repName = (id: string | null) => {
    if (!id) return null;
    const e = employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName ?? ''}`.trim() : null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="CRM · Reassign"
        title="Search & Reassign"
        description="Find any lead — WhatsApp, walk-in, CSV import, never contacted, even junked — and move it to the right rep. Reassignment isn't limited to leads with a WhatsApp chat."
      />

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={dismissBtn} aria-label="Dismiss"><X size={15} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={dismissBtn} aria-label="Dismiss"><X size={15} /></button>
        </div>
      ) : null}

      {/* ── Search + filters ─────────────────────────────────────────────── */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <FormInput
              label="Search"
              placeholder="Name, phone, email, or converted-client name…"
              iconLeft={<Search size={16} />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <FormSelect
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[{ value: '', label: 'Any status' }, ...LEAD_STATUSES.map(([v, l]) => ({ value: v, label: l }))]}
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <FormSelect
              label="Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              options={[{ value: '', label: 'Any source' }, ...sources.map((s) => ({ value: s, label: s }))]}
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <FormSelect
              label="Current rep"
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              options={[
                { value: '', label: 'Any rep' },
                { value: 'UNASSIGNED', label: 'Unassigned' },
                ...employees.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName ?? ''}`.trim() })),
              ]}
            />
          </div>
          <div style={{ minWidth: 170 }}>
            <FormSelect
              label="Records"
              value={deleted}
              onChange={(e) => setDeleted(e.target.value as 'include' | 'exclude' | 'only')}
              options={[
                { value: 'exclude', label: 'Active only' },
                { value: 'include', label: 'Include junk/deleted' },
                { value: 'only', label: 'Junk/deleted only' },
              ]}
            />
          </div>
        </div>
      </GlassCard>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sos-text-faint" style={{ fontSize: 12 }}>
            {loading ? 'Searching…' : `${rows.length} result${rows.length === 1 ? '' : 's'}${truncated ? ' (showing first 50 — narrow your search)' : ''}`}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={th}>Lead</th>
                <th style={th}>Phone</th>
                <th style={th}>Status</th>
                <th style={th}>Source</th>
                <th style={th}>Current rep</th>
                <th style={{ ...th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} style={emptyCell}>Searching…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={emptyCell}>
                    Search by name, phone or email — or use a filter (e.g. Records → “Junk/deleted only”) to browse.
                  </td>
                </tr>
              ) : (
                rows.map((lead) => (
                  <ResultRow
                    key={lead.id}
                    lead={lead}
                    employees={employees}
                    permissions={user.permissions}
                    expanded={expandedId === lead.id}
                    onToggle={() => setExpandedId((cur) => (cur === lead.id ? null : lead.id))}
                    repName={repName}
                    onReassigned={(msg) => {
                      setNotice(msg);
                      setExpandedId(null);
                      reload();
                    }}
                    onError={setError}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}

// The context tabs an admin can see are gated by what they're allowed to read:
// chat needs a WhatsApp-inbox permission, timeline needs a lead/reports read,
// agreement needs a lead/finance read. A super-admin holds all three. Each
// endpoint ALSO enforces scope server-side, so a missing permission means an
// empty/── result, never another rep's data — the gate just hides the tab.
type ContextTabKey = 'chat' | 'timeline' | 'agreement';
const CONTEXT_TABS: Array<{ key: ContextTabKey; label: string; Icon: typeof MessageSquare; anyOf: string[] }> = [
  { key: 'chat', label: 'Chat', Icon: MessageSquare, anyOf: ['whatsapp.view_inbox', 'whatsapp.view_all_inboxes'] },
  { key: 'timeline', label: 'Timeline', Icon: Clock, anyOf: ['leads.view_all', 'leads.view_assigned', 'reports.view'] },
  { key: 'agreement', label: 'Agreement', Icon: FileText, anyOf: ['leads.update', 'finance.view_all', 'settings.manage'] },
];

function ResultRow({
  lead,
  employees,
  permissions,
  expanded,
  onToggle,
  repName,
  onReassigned,
  onError,
}: {
  lead: AdminSearchRow;
  employees: EmployeeOption[];
  permissions: string[];
  expanded: boolean;
  onToggle: () => void;
  repName: (id: string | null) => string | null;
  onReassigned: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [targetRep, setTargetRep] = useState('');
  const [saving, setSaving] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTabKey | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Which context tabs this admin may see. Only leads carry this context
  // (client rows use a different id-space than /leads/:id).
  const contextTabs = lead.type === 'lead'
    ? CONTEXT_TABS.filter((t) => t.anyOf.some((p) => permissions.includes(p)))
    : [];
  const activeContextTab: ContextTabKey | null = contextTab ?? contextTabs[0]?.key ?? null;

  // Lazy-load the assignment history the first time this row is expanded.
  // Client rows use a different id-space than /leads/:id -- skip the fetch
  // rather than 404 (the endpoint is lead-only).
  useEffect(() => {
    if (!expanded || loadedFor.current === lead.id) return;
    loadedFor.current = lead.id;
    if (lead.type !== 'lead') { setHistory([]); return; }
    setHistoryLoading(true);
    apiFetch<HistoryEntry[]>(`/leads/${lead.id}/assignment-history`)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [expanded, lead.id, lead.type]);

  async function reassign() {
    if (!targetRep) return;
    setSaving(true);
    try {
      await apiFetch(`/leads/${lead.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignedEmployeeId: targetRep }),
      });
      const to = employees.find((e) => e.id === targetRep);
      const toName = to ? `${to.firstName} ${to.lastName ?? ''}`.trim() : 'the selected rep';
      onReassigned(`${lead.name} reassigned to ${toName}.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Reassignment failed');
    } finally {
      setSaving(false);
    }
  }

  const currentRep = lead.assignedEmployeeName ?? repName(lead.assignedEmployeeId);
  // Reassign is disabled for: soft-deleted leads (existing rule), converted
  // leads (would silently leave the client with the old rep -- see backend
  // safety net + server 400), and orphan client rows (own flow).
  const reassignBlocked = lead.isDeleted || lead.isConverted || lead.type === 'client';

  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', background: expanded ? 'var(--sos-brand-primary-soft)' : undefined }}
      >
        <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {lead.name}
            {lead.clientName && lead.clientName !== lead.name ? (
              <span className="sos-text-faint" style={{ fontWeight: 400, fontSize: 12 }}>
                (client: {lead.clientName})
              </span>
            ) : null}
            {lead.isDeleted ? (
              <StatusBadge tone="danger" size="sm" dot={false}>Deleted</StatusBadge>
            ) : null}
            {lead.type === 'lead' && lead.isConverted ? (
              <StatusBadge tone="warning" size="sm" dot={false}>Converted → Client</StatusBadge>
            ) : null}
            {lead.type === 'client' ? (
              <StatusBadge tone="info" size="sm" dot={false}>Client (no lead)</StatusBadge>
            ) : null}
          </span>
        </td>
        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>{lead.phone ?? '—'}</td>
        <td style={td}>
          <StatusBadge tone={STATUS_TONE[lead.status] ?? 'neutral'} size="sm">{statusLabel(lead.status)}</StatusBadge>
        </td>
        <td style={td}>{lead.source ?? '—'}</td>
        <td style={td}>{currentRep ?? <span className="sos-text-faint">Unassigned</span>}</td>
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          {reassignBlocked ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-text-muted)', fontWeight: 600, fontSize: 12.5 }}>
              <Lock size={14} /> View
              <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-brand-primary-strong)', fontWeight: 600, fontSize: 12.5 }}>
              <ArrowRightLeft size={14} /> Reassign
              <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
            </span>
          )}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <div style={{ padding: '16px 18px', background: 'var(--sos-surface-2)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20 }}>
              {/* Left: current owner + reassign control */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <UserCheck size={15} style={{ color: 'var(--sos-text-faint)' }} />
                  <span className="sos-text-faint">Current rep:</span>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>{currentRep ?? 'Unassigned'}</strong>
                </div>

                {lead.isDeleted ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
                    <Trash2 size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>This lead is deleted, so it can’t be reassigned. Restore it from the Leads page first if it needs an owner.</span>
                  </div>
                ) : lead.type === 'lead' && lead.isConverted ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--sos-text-primary)', padding: '10px 12px', borderRadius: 8, background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)' }}>
                    <Lock size={16} style={{ marginTop: 2, flexShrink: 0, color: 'var(--sos-status-warning)' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <strong>This lead has been converted to a client.</strong>
                      <span>
                        Client is currently assigned to{' '}
                        <strong>{lead.convertedClientAssignedEmployeeName ?? 'no one'}</strong>
                        {lead.convertedClientPhone && lead.convertedClientPhone !== lead.phone
                          ? ` (phone on file: ${lead.convertedClientPhone})`
                          : null}
                        . Reassigning the lead alone won&apos;t change client ownership or Telenor call routing —
                        the client record has to be updated separately.
                      </span>
                    </div>
                  </div>
                ) : lead.type === 'client' ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--sos-text-primary)', padding: '10px 12px', borderRadius: 8, background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-border-subtle)' }}>
                    <Lock size={16} style={{ marginTop: 2, flexShrink: 0, color: 'var(--sos-brand-primary-strong)' }} />
                    <div>
                      <strong>Client record.</strong>{' '}
                      Client reassignment is not part of this page — it lives with the client management flow.
                      Shown here so you know the record exists.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 220, flex: 1 }}>
                      <FormSelect
                        label="Reassign to"
                        value={targetRep}
                        onChange={(e) => setTargetRep(e.target.value)}
                        options={[
                          { value: '', label: 'Choose a rep…' },
                          ...employees
                            .filter((e) => e.id !== lead.assignedEmployeeId)
                            .map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName ?? ''}`.trim() })),
                        ]}
                      />
                    </div>
                    <SecondaryButton
                      onClick={() => void reassign()}
                      disabled={!targetRep || saving}
                      iconLeft={saving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightLeft size={15} />}
                    >
                      {saving ? 'Reassigning…' : 'Reassign'}
                    </SecondaryButton>
                  </div>
                )}
              </div>

              {/* Right: assignment history */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--sos-text-faint)' }}>
                  <History size={14} /> Assignment history
                </div>
                {historyLoading ? (
                  <div className="sos-text-faint" style={{ fontSize: 12.5 }}>Loading…</div>
                ) : !history || history.length === 0 ? (
                  <div className="sos-text-faint" style={{ fontSize: 12.5 }}>
                    No recorded reassignments. {currentRep ? `Currently with ${currentRep}.` : 'Currently unassigned.'}
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {history.map((h) => (
                      <li key={h.id} style={{ display: 'flex', gap: 8, fontSize: 12.5 }}>
                        <span className="sos-text-faint" style={{ whiteSpace: 'nowrap', minWidth: 130 }}>{fmtDateTime(h.at)}</span>
                        <span style={{ color: 'var(--sos-text-secondary)' }}>
                          {h.toEmployeeName ? `→ ${h.toEmployeeName}` : h.description ?? 'Assigned'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                  Created {fmtDate(lead.createdAt)} · updated {fmtDate(lead.updatedAt)}
                </div>
              </div>
            </div>

            {/* Context panel — chat / timeline / agreement, read-only, so the
                admin reassigns with the full story rather than blindly. Only
                for lead rows; each tab is gated on the admin's own permission
                and its endpoint is scope-enforced server-side. */}
            {contextTabs.length > 0 && activeContextTab ? (
              <div style={{ padding: '0 18px 18px', background: 'var(--sos-surface-2)' }}>
                <div style={{ borderTop: '1px solid var(--sos-border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="sos-text-faint" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                      Before you reassign
                    </span>
                    <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                      {contextTabs.map((t) => {
                        const active = t.key === activeContextTab;
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => setContextTab(t.key)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                              border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                              background: active ? 'var(--sos-brand-primary-soft)' : 'transparent',
                              color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
                              fontSize: 12.5, fontWeight: 600,
                            }}
                          >
                            <t.Icon size={14} /> {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {activeContextTab === 'chat' ? (
                    <div style={{ height: 460, display: 'flex', flexDirection: 'column', border: '1px solid var(--sos-border-subtle)', borderRadius: 10, overflow: 'hidden' }}>
                      <WhatsAppLeadTab leadId={lead.id} leadPhone={lead.phone} fillHeight readOnly />
                    </div>
                  ) : activeContextTab === 'timeline' ? (
                    <LeadActivityTimeline leadId={lead.id} compact />
                  ) : activeContextTab === 'agreement' ? (
                    <LeadAgreementSummary leadId={lead.id} />
                  ) : null}
                </div>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

const emptyCell: CSSProperties = {
  padding: 30,
  textAlign: 'center',
  color: 'var(--sos-text-muted)',
  fontSize: 13.5,
};

const dismissBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
};
