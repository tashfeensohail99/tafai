'use client';

// Admin · Sales · Agent detail
//
// Shows everything a manager needs to inspect ONE sales agent without
// physically walking to their desk:
//
//   - Identity strip (name, role, status, presence, WhatsApp pool flag)
//   - 5-card KPI strip mirroring the overview row
//   - Master/detail panel:
//       * left  — list of leads currently assigned to this agent
//       * right — activity timeline of whichever lead the admin clicks
//
// Selecting a lead populates the timeline panel inline; an "Open lead" link
// in the panel header sends the admin to the full lead profile when they
// need to take action rather than just observe.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock4,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  PhoneOff,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  Timeline,
  TimelineStep,
} from '@/components/sales-v2/ui';
import {
  fetchLeadActivityTimeline,
  type ActivityTimelineEntry,
} from '@/lib/sales-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployeeDetail {
  id: string;
  firstName: string;
  lastName: string;
  isActive?: boolean;
  whatsappInboxMember?: boolean;
  presenceStatus?: 'ONLINE' | 'AWAY' | 'OFFLINE';
  lastActivityAt?: string | null;
  department?: { name?: string | null } | null;
  branch?: { name?: string | null } | null;
  user?: {
    email?: string | null;
    phone?: string | null;
    status?: string | null;
    userRoles?: Array<{ role: { name: string; displayName: string } }>;
  } | null;
}

interface AssignedLead {
  id: string;
  referenceCode?: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  status: string;
  priority?: string | null;
  serviceInterest?: string | null;
  targetCountry?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirror the eventType → icon map used on the lead profile so the inline
// timeline here looks identical. Keep this in sync with TIMELINE_EVENT_META
// in SalesLeadProfilePage.
const TIMELINE_EVENT_META: Record<
  string,
  { Icon: typeof Activity; title: string }
> = {
  LEAD_CREATED:          { Icon: Sparkles,     title: 'Lead created' },
  LEAD_CONTACTED:        { Icon: Phone,        title: 'Lead contacted' },
  LEAD_QUALIFIED:        { Icon: ShieldCheck,  title: 'Lead qualified' },
  LEAD_ASSIGNED:         { Icon: Shield,       title: 'Lead assigned' },
  LEAD_CONVERTED:        { Icon: CheckCircle2, title: 'Lead converted' },
  LEAD_STATUS_CHANGED:   { Icon: Activity,     title: 'Status changed' },
  LEAD_UPDATED:          { Icon: ClipboardList,title: 'Lead updated' },
  LEAD_DELETED:          { Icon: X,            title: 'Lead deleted' },
  LEAD_FILE_UPLOADED:    { Icon: Paperclip,    title: 'File uploaded' },
  LEAD_FILE_DELETED:     { Icon: X,            title: 'File deleted' },
  FOLLOW_UP_CREATED:     { Icon: CalendarPlus, title: 'Follow-up created' },
  FOLLOW_UP_COMPLETED:   { Icon: Check,        title: 'Follow-up done' },
  FOLLOW_UP_RESCHEDULED: { Icon: CalendarClock,title: 'Follow-up rescheduled' },
  APPOINTMENT_SCHEDULED: { Icon: CalendarPlus, title: 'Appointment booked' },
  APPOINTMENT_COMPLETED: { Icon: CheckCircle2, title: 'Appointment completed' },
  APPOINTMENT_CANCELLED: { Icon: X,            title: 'Appointment cancelled' },
  APPOINTMENT_RESCHEDULED:{Icon: CalendarClock,title: 'Appointment rescheduled' },
  APPOINTMENT_NO_SHOW:   { Icon: PhoneOff,     title: 'No-show' },
  WHATSAPP_LEAD_CREATED: { Icon: MessageSquare,title: 'WhatsApp lead created' },
  WHATSAPP_MESSAGE_RECEIVED: { Icon: MessageSquare, title: 'WhatsApp received' },
  WHATSAPP_MESSAGE_SENT: { Icon: MessageSquare,title: 'WhatsApp sent' },
  WHATSAPP_ASSIGNED:     { Icon: Shield,       title: 'WhatsApp routed' },
  EMAIL_RECEIVED:        { Icon: Mail,         title: 'Email received' },
  EMAIL_VERIFICATION_SENT: { Icon: Mail,       title: 'Verification email sent' },
  EMAIL_VERIFIED:        { Icon: ShieldCheck,  title: 'Email verified' },
  PAYMENT_RECEIVED:      { Icon: Wallet,       title: 'Payment received' },
  FINANCE_HANDOVER_SUBMITTED: { Icon: Send,    title: 'Finance handover sent' },
  FINANCE_HANDOVER_REVIEWED:  { Icon: CheckCircle2, title: 'Finance reviewed' },
  DOCUMENT_UPLOADED:     { Icon: Upload,       title: 'Document uploaded' },
  DOCUMENT_VERIFIED:     { Icon: CheckCircle2, title: 'Document verified' },
  DOCUMENT_REJECTED:     { Icon: X,            title: 'Document rejected' },
  NOTE_ADDED:            { Icon: StickyNote,   title: 'Note added' },
};

const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  NEW: 'info',
  CONTACTED: 'info',
  QUALIFIED: 'success',
  PROPOSAL_SENT: 'warning',
  FOLLOW_UP: 'warning',
  CONVERTED: 'success',
  LOST: 'danger',
  DUPLICATE: 'neutral',
  UNQUALIFIED: 'neutral',
};

// Friendly lead-status labels. "New" is the lead's PIPELINE stage (assigned,
// not yet moved to Contacted) — deliberately distinct from "Awaiting reply",
// which is a messaging signal (client texted, rep hasn't personally replied).
const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL_SENT: 'Proposal sent',
  FOLLOW_UP: 'Follow-up',
  CONVERTED: 'Converted',
  LOST: 'Lost',
  DUPLICATE: 'Duplicate',
  UNQUALIFIED: 'Unqualified',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function initials(first: string, last: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

function presenceColor(p: EmployeeDetail['presenceStatus']): string {
  if (p === 'ONLINE') return 'var(--sos-status-success)';
  if (p === 'AWAY') return 'var(--sos-status-warning)';
  return 'var(--sos-text-muted)';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SalesAgentDetailPage({ employeeId }: { employeeId: string }) {
  const { user } = useAdminSession();
  const canView =
    user.permissions.includes('reports.view') ||
    user.permissions.includes('leads.view_all');

  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [leads, setLeads] = useState<AssignedLead[]>([]);
  // Lead IDs for this rep's "awaiting reply" chats (client texted, no human
  // reply) — same rule as the overview KPI, so the count matches there.
  const [awaitingReplyIds, setAwaitingReplyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Reassign-a-lead modal state (reuses POST /leads/:id/assign).
  const [reassignLead, setReassignLead] = useState<AssignedLead | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  // Layout state.
  // `narrow`        — viewport too tight for the two-pane layout, so we
  //                   stack the leads list above the timeline. Detected via
  //                   matchMedia so we react to live resizes without a
  //                   useState/event-listener boilerplate.
  // `listCollapsed` — admin clicked the collapse arrow to give the timeline
  //                   the full width. Independent from `narrow` so admins
  //                   on wide screens can still collapse.
  const [narrow, setNarrow] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Lead-list load. Filter applied client-side because lead counts here are
  // bounded (a single agent's roster — usually < 300) and the server-side
  // search filter doesn't currently expose ref code matching.
  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [emp, leadList, awaitingIds] = await Promise.all([
        apiFetch<EmployeeDetail>(`/employees/${employeeId}`),
        // limit=1000 (the API's max) so the status tabs + KPI counts reflect the
        // agent's FULL roster — without it the endpoint defaults to 250 rows and
        // a busy rep's counts (e.g. "New") would be computed from a slice.
        apiFetch<AssignedLead[]>(`/leads?assignedEmployeeId=${employeeId}&limit=1000`),
        // Conversations the rep hasn't personally replied to (best-effort).
        apiFetch<string[]>(`/reports/sales-agent/${employeeId}/awaiting-reply-leads`).catch(
          () => [] as string[],
        ),
      ]);
      setEmployee(emp);
      setLeads(leadList ?? []);
      setAwaitingReplyIds(new Set(awaitingIds ?? []));
      // Auto-pick the first lead so the right pane isn't empty on first paint.
      if (!selectedLeadId && leadList && leadList.length > 0) {
        setSelectedLeadId(leadList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load agent detail');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Candidate reps for the reassign picker (admin-only page).
  useEffect(() => {
    if (!canView) return;
    apiFetch<Array<{ id: string; firstName: string; lastName: string }>>('/employees')
      .then((list) => setEmployees(list ?? []))
      .catch(() => setEmployees([]));
  }, [canView]);

  const handleReassign = async () => {
    if (!reassignLead || !reassignTargetId) return;
    setReassigning(true);
    setReassignError(null);
    try {
      await apiFetch(`/leads/${reassignLead.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignedEmployeeId: reassignTargetId }),
      });
      setReassignLead(null);
      setReassignTargetId('');
      await load(); // the reassigned lead drops off this agent's roster
    } catch (err) {
      setReassignError(err instanceof Error ? err.message : 'Reassign failed');
    } finally {
      setReassigning(false);
    }
  };

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter === 'AWAITING_REPLY') {
        if (!awaitingReplyIds.has(l.id)) return false;
      } else if (statusFilter !== 'ALL' && l.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        l.firstName.toLowerCase().includes(q) ||
        l.lastName.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        (l.email ?? '').toLowerCase().includes(q) ||
        (l.referenceCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [leads, search, statusFilter, awaitingReplyIds]);

  // KPI snapshots
  const kpis = useMemo(() => {
    const now = Date.now();
    const newCount = leads.filter((l) => l.status === 'NEW').length;
    const contactedCount = leads.filter((l) => l.status === 'CONTACTED').length;
    const convertedCount = leads.filter((l) => l.status === 'CONVERTED').length;
    const stale7d = leads.filter(
      (l) => l.status !== 'CONVERTED' && l.status !== 'LOST' && now - new Date(l.updatedAt).getTime() > 7 * 24 * 3600 * 1000,
    ).length;
    return {
      total: leads.length,
      newCount,
      contactedCount,
      convertedCount,
      stale7d,
    };
  }, [leads]);

  if (!canView) return <PermissionDeniedState />;
  if (loading && !employee) return <LoadingState message="Loading agent detail…" />;
  if (error && !employee) {
    return <ErrorState message="Unable to load agent" details={error} onRetry={() => void load()} />;
  }
  if (!employee) return null;

  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const role =
    employee.user?.userRoles?.[0]?.role?.displayName ??
    employee.user?.userRoles?.[0]?.role?.name ??
    'Sales';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        minWidth: 0,
        // Belt + braces — even if a nested grid child forgets minWidth:0,
        // the page itself never grows horizontal scrollbars.
        overflowX: 'hidden',
      }}
    >
      {/* ── Back link ── */}
      <Link
        href={'/admin/sales' as Route}
        className="sos-btn sos-btn--ghost sos-btn--sm"
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <ArrowLeft size={13} />
        Back to sales overview
      </Link>

      {/* ── Header (mirrors EmployeesAdminPage identity + status pattern) ── */}
      <GlassCard variant="strong" padded="lg">
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Avatar with presence dot */}
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--sos-brand-primary-soft)',
              color: 'var(--sos-brand-primary-strong)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 22,
              fontWeight: 700,
              position: 'relative',
              flexShrink: 0,
            }}
          >
            {initials(employee.firstName, employee.lastName)}
            <span
              style={{
                position: 'absolute',
                right: 2,
                bottom: 2,
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: presenceColor(employee.presenceStatus),
                border: '3px solid var(--sos-bg-elevated)',
              }}
              aria-label={`presence ${employee.presenceStatus ?? 'OFFLINE'}`}
            />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sos-eyebrow">Sales · Admin</div>
            <h1
              className="sos-title"
              style={{ fontSize: 22, marginTop: 4, color: 'var(--sos-text-primary)' }}
            >
              {fullName}
            </h1>
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <StatusBadge tone="info" size="sm">{role}</StatusBadge>
              {employee.whatsappInboxMember ? (
                <StatusBadge tone="accent" size="sm">WhatsApp pool</StatusBadge>
              ) : null}
              {employee.user?.status === 'ACTIVE' ? (
                <StatusBadge tone="success" size="sm">Active</StatusBadge>
              ) : (
                <StatusBadge tone="warning" size="sm">{employee.user?.status ?? 'Inactive'}</StatusBadge>
              )}
              <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                Last active {fmtRelative(employee.lastActivityAt)}
              </span>
            </div>
            {employee.user?.email ? (
              <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
                {employee.user.email}
                {employee.user.phone ? ` · ${employee.user.phone}` : ''}
                {employee.department?.name ? ` · ${employee.department.name}` : ''}
                {employee.branch?.name ? ` · ${employee.branch.name}` : ''}
              </div>
            ) : null}
          </div>
        </div>
      </GlassCard>

      {/* ── KPIs ── */}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <MetricCard label="Total leads" value={kpis.total} tone="info" Icon={ClipboardList} />
        <MetricCard label="New" value={kpis.newCount} tone="accent" Icon={Sparkles} />
        <MetricCard label="Contacted" value={kpis.contactedCount} tone="info" Icon={Phone} />
        <MetricCard label="Converted" value={kpis.convertedCount} tone="success" Icon={BadgeCheck} />
        <MetricCard label="Stale (>7d)" value={kpis.stale7d} tone={kpis.stale7d > 0 ? 'warning' : 'neutral'} Icon={Clock4} />
      </div>

      {/* ── Master / detail: leads (left) + timeline (right) ─────────────
            Grid template flexes between three modes:
              - narrow viewport (<=900px) → single column, panes stack.
              - listCollapsed=true        → 56px rail + 1fr timeline. The
                rail shows just an expand chevron + lead count so the
                timeline takes the full width. Useful when admin wants
                to focus on a long activity history.
              - default (wide)            → leads list dominates so every
                row can show its full name, ref code, status badge, and
                last-updated time without truncating. Timeline is the
                slim companion column, clamped at ~28vw / max 340px.
            All scroll regions use sos-scroll for a premium thin scrollbar.
            No element forces a min-width that exceeds the column, so
            horizontal scrolling is eliminated.                            ── */}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: narrow
            ? '1fr'
            : listCollapsed
              ? '56px minmax(0, 1fr)'
              : 'minmax(0, 1fr) clamp(260px, 28vw, 340px)',
          alignItems: 'stretch',
          minWidth: 0,
        }}
      >
        {/* Left pane: assigned leads (collapsible rail on wide screens) */}
        <GlassCard variant="panel" padded={false} style={{ minWidth: 0 }}>
          {/* Collapsed rail — narrow vertical sidebar with just an expand
              affordance, a lead-count chip, and a search shortcut button. */}
          {!narrow && listCollapsed ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                padding: '14px 0',
                height: '100%',
              }}
            >
              <button
                type="button"
                onClick={() => setListCollapsed(false)}
                title="Expand leads list"
                aria-label="Expand leads list"
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--sos-text-muted)',
                  transition: 'background 120ms, color 120ms',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--sos-surface-hover)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-primary)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-muted)';
                }}
              >
                <ChevronRight size={16} />
              </button>
              <div
                title={`${leads.length} leads`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  color: 'var(--sos-text-muted)',
                  fontSize: 11,
                }}
              >
                <Users size={14} />
                <span style={{ fontWeight: 700, color: 'var(--sos-text-primary)' }}>{leads.length}</span>
              </div>
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--sos-divider)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flexShrink: 0, minWidth: 0 }}>
                  <div className="sos-eyebrow">Assigned leads</div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--sos-text-primary)',
                    }}
                  >
                    {filteredLeads.length} of {leads.length}
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 160,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Search
                    size={13}
                    style={{ position: 'absolute', left: 10, color: 'var(--sos-text-muted)' }}
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, phone, ref…"
                    className="sos-input"
                    style={{ paddingLeft: 30, width: '100%' }}
                  />
                </div>
                {!narrow ? (
                  <button
                    type="button"
                    onClick={() => setListCollapsed(true)}
                    title="Collapse list to give the timeline more room"
                    aria-label="Collapse leads list"
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--sos-text-muted)',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--sos-surface-hover)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-primary)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-muted)';
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                ) : null}
              </div>

              {/* Lead-status filter tabs */}
              <StatusTabs
                leads={leads}
                value={statusFilter}
                onChange={setStatusFilter}
                awaitingReplyCount={awaitingReplyIds.size}
              />

              <div
                className="sos-scroll"
                style={{
                  // Tie to viewport so the panes feel like an integrated
                  // dashboard instead of two fixed-height widgets pasted in.
                  maxHeight: 'calc(100vh - 360px)',
                  minHeight: 360,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                }}
              >
            {filteredLeads.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--sos-text-muted)',
                  fontSize: 13,
                }}
              >
                {leads.length === 0
                  ? 'No leads assigned to this agent.'
                  : 'No leads match your search.'}
              </div>
            ) : (
              filteredLeads.map((lead) => {
                const selected = lead.id === selectedLeadId;
                const tone = STATUS_TONE[lead.status] ?? 'neutral';
                return (
                  <div
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedLeadId(lead.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedLeadId(lead.id);
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      display: 'block',
                      width: '100%',
                      // 26px on the right so the StatusBadge clears the
                      // 8px sos-scroll bar with comfortable breathing room
                      // — fixes the "CONTACTE…" / "NEV" clipping the user
                      // reported. Left side keeps 16px (no scrollbar there).
                      padding: '10px 26px 10px 16px',
                      boxSizing: 'border-box',
                      borderBottom: '1px solid var(--sos-divider)',
                      background: selected ? 'rgba(59,130,246,0.10)' : 'transparent',
                      borderLeft: selected
                        ? '3px solid var(--sos-brand-primary-strong)'
                        : '3px solid transparent',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={(e) => {
                      if (!selected)
                        (e.currentTarget as HTMLElement).style.background =
                          'rgba(255,255,255,0.025)';
                    }}
                    onMouseLeave={(e) => {
                      if (!selected)
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: 'var(--sos-text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {lead.firstName} {lead.lastName}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--sos-text-muted)',
                            marginTop: 2,
                          }}
                        >
                          {lead.phone}
                          {lead.referenceCode ? ` · ${lead.referenceCode}` : ''}
                        </div>
                        {lead.serviceInterest || lead.targetCountry ? (
                          <div
                            style={{
                              fontSize: 11.5,
                              color: 'var(--sos-text-faint)',
                              marginTop: 3,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {[lead.serviceInterest, lead.targetCountry]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        ) : null}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 4,
                          flexShrink: 0,
                        }}
                      >
                        <StatusBadge tone={tone} size="sm">{STATUS_LABEL[lead.status] ?? lead.status}</StatusBadge>
                        {awaitingReplyIds.has(lead.id) ? (
                          <span
                            title="Client messaged — rep hasn't personally replied (bot or no reply)"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: 'var(--sos-status-warning-soft, rgba(245,158,11,0.12))',
                              color: 'var(--sos-status-warning)',
                              border: '1px solid var(--sos-status-warning)',
                            }}
                          >
                            Awaiting reply
                          </span>
                        ) : null}
                        <span
                          style={{ fontSize: 10.5, color: 'var(--sos-text-faint)' }}
                        >
                          {fmtRelative(lead.updatedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReassignLead(lead);
                            setReassignTargetId('');
                            setReassignError(null);
                          }}
                          title="Reassign this lead to another salesperson"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            marginTop: 2,
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 10.5,
                            cursor: 'pointer',
                            border: '1px solid var(--sos-border)',
                            background: 'var(--sos-surface)',
                            color: 'var(--sos-text-secondary)',
                          }}
                        >
                          <Shield size={10} /> Reassign
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
              </div>
            </>
          )}
        </GlassCard>

        {/* Right pane: activity timeline for the selected lead */}
        <GlassCard variant="panel" padded={false} style={{ minWidth: 0 }}>
          {selectedLeadId ? (
            <SelectedLeadTimelinePanel leadId={selectedLeadId} />
          ) : (
            <div
              style={{
                padding: 48,
                textAlign: 'center',
                color: 'var(--sos-text-muted)',
                fontSize: 13,
              }}
            >
              Select a lead on the left to see its activity timeline here.
            </div>
          )}
        </GlassCard>
      </div>

      {reassignLead ? (
        <div
          onClick={() => { if (!reassigning) setReassignLead(null); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(440px, 92vw)',
              background: 'var(--sos-surface-1)',
              border: '1px solid var(--sos-border)',
              borderRadius: 'var(--sos-radius-lg)',
              padding: 20,
              boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 4 }}>
              Reassign lead
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              Move <strong>{reassignLead.firstName} {reassignLead.lastName}</strong> to another salesperson.
              They become the assigned rep (sticky for future inbound) and are notified.
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-muted)' }}>
              Assign to
            </label>
            <select
              className="sos-select"
              value={reassignTargetId}
              onChange={(e) => setReassignTargetId(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            >
              <option value="">Select a salesperson…</option>
              {employees
                .filter((emp) => emp.id !== employeeId)
                .map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                ))}
            </select>
            {reassignError ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sos-status-danger)' }}>{reassignError}</div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button
                type="button"
                disabled={reassigning}
                onClick={() => setReassignLead(null)}
                className="sos-btn sos-btn--ghost sos-btn--sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reassigning || !reassignTargetId}
                onClick={() => void handleReassign()}
                className="sos-btn sos-btn--primary sos-btn--sm"
              >
                {reassigning ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead-status filter tabs
// ---------------------------------------------------------------------------

const STATUS_TAB_ORDER = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'FOLLOW_UP',
  'PROPOSAL_SENT',
  'CONVERTED',
  'LOST',
  'DUPLICATE',
  'UNQUALIFIED',
];

function StatusTabs({
  leads,
  value,
  onChange,
  awaitingReplyCount,
}: {
  leads: AssignedLead[];
  value: string;
  onChange: (s: string) => void;
  awaitingReplyCount: number;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.status, (m.get(l.status) ?? 0) + 1);
    return m;
  }, [leads]);
  // "Awaiting reply" is a cross-cutting filter (a messaging signal), not a
  // pipeline status — it sits right after All and is highlighted when > 0.
  const tabs: Array<{ key: string; label: string; count: number; highlight?: boolean }> = [
    { key: 'ALL', label: 'All', count: leads.length },
    { key: 'AWAITING_REPLY', label: 'Awaiting reply', count: awaitingReplyCount, highlight: true },
    ...STATUS_TAB_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      key: s,
      label: STATUS_LABEL[s] ?? s,
      count: counts.get(s) ?? 0,
    })),
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        padding: '10px 14px',
        borderBottom: '1px solid var(--sos-divider)',
      }}
    >
      {tabs.map((t) => {
        const active = value === t.key;
        const danger = !!t.highlight && t.count > 0;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              border: `1px solid ${
                active
                  ? 'var(--sos-border-accent)'
                  : danger
                    ? 'var(--sos-status-warning)'
                    : 'var(--sos-border)'
              }`,
              background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface)',
              color: active
                ? 'var(--sos-brand-primary-strong)'
                : danger
                  ? 'var(--sos-status-warning)'
                  : 'var(--sos-text-secondary)',
            }}
          >
            {t.label}
            <span style={{ opacity: 0.7 }}>{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline panel (right column)
// ---------------------------------------------------------------------------

function SelectedLeadTimelinePanel({ leadId }: { leadId: string }) {
  const [entries, setEntries] = useState<ActivityTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchLeadActivityTimeline(leadId);
        if (!cancelled) setEntries(rows);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load timeline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--sos-divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="sos-eyebrow">Activity timeline</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', marginTop: 2 }}>
            {loading
              ? 'Loading…'
              : `${entries.length} event${entries.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <Link
          href={`/sales/leads/${leadId}?tab=activity` as Route}
          target="_blank"
          rel="noopener noreferrer"
          className="sos-btn sos-btn--ghost sos-btn--sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          Open lead
          <ExternalLink size={12} />
        </Link>
      </div>

      <div
        className="sos-scroll"
        style={{
          // Same viewport-driven height as the leads list so the two
          // panes feel like a coordinated dashboard rather than
          // disconnected widgets. minHeight prevents collapse on small
          // datasets.
          maxHeight: 'calc(100vh - 360px)',
          minHeight: 360,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 18px',
        }}
      >
        {error ? (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--sos-status-danger-soft)',
              color: 'var(--sos-status-danger)',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : loading && entries.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--sos-text-muted)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Loader2 size={14} className="sos-spin" />
            Loading timeline…
          </div>
        ) : entries.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--sos-text-muted)',
              fontSize: 13,
            }}
          >
            No activity recorded on this lead yet.
          </div>
        ) : (
          <Timeline>
            {entries.map((entry) => {
              const meta = TIMELINE_EVENT_META[entry.eventType] ?? {
                Icon: Activity,
                title: prettifyEventType(entry.eventType),
              };
              return (
                <TimelineStep
                  key={entry.id}
                  Icon={meta.Icon}
                  title={meta.title}
                  meta={fmtRelative(entry.createdAt)}
                  description={entry.description}
                  done
                />
              );
            })}
          </Timeline>
        )}
      </div>
    </div>
  );
}

function prettifyEventType(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' ');
}
