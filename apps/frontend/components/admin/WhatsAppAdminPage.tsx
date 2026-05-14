'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MessageSquare, RefreshCw } from 'lucide-react';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  listThreads,
  reassignThread,
  type ThreadListItem,
  type WhatsAppThreadStatus,
} from '@/lib/whatsapp';
import { listTeamPresence, type TeamPresenceRow } from '@/lib/whatsapp-admin';

type StatusFilter = WhatsAppThreadStatus | 'ALL';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'ARCHIVED', label: 'Archived' },
];

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function statusTone(status: WhatsAppThreadStatus): BadgeTone {
  switch (status) {
    case 'OPEN':
      return 'info';
    case 'PENDING':
      return 'warning';
    case 'RESOLVED':
      return 'success';
    case 'ARCHIVED':
      return 'neutral';
  }
}

export function WhatsAppAdminPage() {
  const { user } = useAdminSession();
  const canViewAll = user.permissions.includes('whatsapp.view_all_inboxes');
  const canReassign = user.permissions.includes('whatsapp.reassign');

  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [team, setTeam] = useState<TeamPresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<StatusFilter>('OPEN');
  const [filterUnassigned, setFilterUnassigned] = useState(false);
  const [search, setSearch] = useState('');

  const [reassignTarget, setReassignTarget] = useState<ThreadListItem | null>(null);
  const [reassignEmployee, setReassignEmployee] = useState<string>('');
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function load() {
    if (!canViewAll) return;
    setLoading(true);
    setError(null);
    try {
      const [t, p] = await Promise.all([
        listThreads({
          status: filterStatus === 'ALL' ? undefined : filterStatus,
          unassigned: filterUnassigned || undefined,
          search: search.trim() || undefined,
        }),
        listTeamPresence(),
      ]);
      setThreads(t.items);
      setTeam(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load WhatsApp data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canViewAll, filterStatus, filterUnassigned]);

  if (!canViewAll) return <PermissionDeniedState />;

  async function handleReassign() {
    if (!reassignTarget || !reassignEmployee) return;
    setReassignBusy(true);
    setReassignError(null);
    try {
      const result = await reassignThread(reassignTarget.id, reassignEmployee);
      setConfirmation(`Reassigned to ${result.assignedEmployeeName}.`);
      setReassignTarget(null);
      setReassignEmployee('');
      void load();
    } catch (err) {
      setReassignError(err instanceof Error ? err.message : 'Reassign failed');
    } finally {
      setReassignBusy(false);
    }
  }

  const eligibleTeam = useMemo(
    () => team.filter((t) => t.whatsappInboxMember).sort((a, b) => a.name.localeCompare(b.name)),
    [team],
  );

  const unassignedCount = threads.filter((t) => !t.lead?.assignedEmployeeId).length;
  const breachedCount = threads.filter((t) => t.slaBreached).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="WhatsApp · Admin"
        title="All conversations"
        description="Every WhatsApp thread across the team. Filter, search, and reassign to a specific agent."
        actions={
          <PrimaryButton iconLeft={<RefreshCw size={14} />} onClick={() => void load()}>
            Refresh
          </PrimaryButton>
        }
      />

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <MetricCard
          label="Active threads"
          value={threads.length}
          hint="OPEN or PENDING in current view"
          tone="accent"
          Icon={MessageSquare}
        />
        <MetricCard
          label="Unassigned"
          value={unassignedCount}
          hint="No sales rep yet"
          tone={unassignedCount > 0 ? 'warning' : 'neutral'}
          Icon={AlertTriangle}
        />
        <MetricCard
          label="SLA breached"
          value={breachedCount}
          hint="Past first-response deadline"
          tone={breachedCount > 0 ? 'danger' : 'neutral'}
          Icon={AlertTriangle}
        />
      </div>

      {confirmation ? (
        <div className="sos-banner sos-banner--success">{confirmation}</div>
      ) : null}

      {/* Filter strip */}
      <GlassCard variant="soft" padded="md">
        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilterStatus(t.key)}
              style={{
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                background:
                  filterStatus === t.key ? 'var(--sos-brand-primary-soft)' : 'transparent',
                color:
                  filterStatus === t.key
                    ? 'var(--sos-brand-primary-strong)'
                    : 'var(--sos-text-muted)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            color: 'var(--sos-text-secondary)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={filterUnassigned}
            onChange={(e) => setFilterUnassigned(e.target.checked)}
          />
          Unassigned only
        </label>

        <input
          type="search"
          className="sos-input"
          placeholder="Search name, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
          style={{ maxWidth: 280, marginLeft: 'auto' }}
        />
        <GhostButton onClick={() => void load()} size="sm">Apply</GhostButton>
        </div>
      </GlassCard>

      {loading && threads.length === 0 ? (
        <LoadingState message="Loading conversations..." />
      ) : error && threads.length === 0 ? (
        <ErrorState
          message="Unable to load conversations"
          details={error}
          onRetry={() => void load()}
        />
      ) : threads.length === 0 ? (
        <GlassCard variant="soft" padded="lg">
          <div className="sos-text-muted" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
            No conversations match these filters.
          </div>
        </GlassCard>
      ) : (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threads.map((t) => {
              const name = t.lead
                ? `${t.lead.firstName} ${t.lead.lastName}`.trim()
                : t.client
                  ? `${t.client.firstName} ${t.client.lastName}`.trim()
                  : t.waContactId;
              const phone = t.lead?.phone ?? t.client?.phone ?? t.waContactId;
              const assignedName = t.lead?.assignedEmployee
                ? `${t.lead.assignedEmployee.firstName} ${t.lead.assignedEmployee.lastName}`.trim()
                : null;
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    background: 'var(--sos-surface-1)',
                    border: '1px solid var(--sos-border-subtle)',
                    borderRadius: 'var(--sos-radius-sm)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        marginBottom: 4,
                      }}
                    >
                      <strong style={{ fontSize: 14, color: 'var(--sos-text-primary)' }}>{name}</strong>
                      <StatusBadge tone={statusTone(t.status)} size="sm">
                        {t.status.toLowerCase()}
                      </StatusBadge>
                      {t.slaBreached ? (
                        <StatusBadge tone="danger" size="sm">SLA breached</StatusBadge>
                      ) : null}
                      {!assignedName ? (
                        <StatusBadge tone="warning" size="sm">Unassigned</StatusBadge>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                      {phone} · via {t.channel.label} · last activity {fmtRelative(t.lastMessageAt)}
                      {t.lastMessagePreview ? ` — ${t.lastMessagePreview.slice(0, 80)}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sos-text-secondary)', marginTop: 4 }}>
                      {assignedName ? (
                        <strong style={{ color: 'var(--sos-text-primary)' }}>{assignedName}</strong>
                      ) : (
                        <em style={{ color: 'var(--sos-text-muted)' }}>No agent assigned</em>
                      )}
                      {t.unreadCount > 0 ? ` · ${t.unreadCount} unread` : ''}
                    </div>
                  </div>
                  {canReassign ? (
                    <GhostButton
                      size="sm"
                      onClick={() => {
                        setReassignTarget(t);
                        setReassignEmployee('');
                        setReassignError(null);
                      }}
                    >
                      Reassign
                    </GhostButton>
                  ) : null}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* ---- Reassign modal ---- */}
      {reassignTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReassignTarget(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--sos-bg-overlay)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '6vh 16px',
            zIndex: 1000,
          }}
        >
          <div
            className="sos-glass sos-glass--strong"
            style={{ width: '100%', maxWidth: 480, padding: 0, borderRadius: 'var(--sos-radius-panel)' }}
          >
            <header
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--sos-border-subtle)',
              }}
            >
              <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>
                Reassign thread
              </div>
              <div className="sos-text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {reassignTarget.lead
                  ? `${reassignTarget.lead.firstName} ${reassignTarget.lead.lastName} · ${reassignTarget.lead.phone}`
                  : reassignTarget.waContactId}
              </div>
            </header>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--sos-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Route to
                </span>
                <select
                  className="sos-select"
                  value={reassignEmployee}
                  onChange={(e) => setReassignEmployee(e.target.value)}
                >
                  <option value="" disabled>Pick a WhatsApp inbox member…</option>
                  {eligibleTeam.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.effective === 'ONLINE' ? '(online)' : m.effective === 'AWAY' ? '(away)' : '(offline)'}
                      {' · '}
                      {m.openLeads} open
                    </option>
                  ))}
                </select>
              </label>
              <div
                style={{
                  fontSize: 12,
                  padding: '8px 10px',
                  background: 'var(--sos-status-info-soft)',
                  border: '1px solid var(--sos-status-info-border)',
                  borderRadius: 'var(--sos-radius-sm)',
                }}
              >
                The selected agent also becomes this lead's sticky preference — any future inbound on the same number will come back to them.
              </div>
              {reassignError ? (
                <div className="sos-banner sos-banner--danger">{reassignError}</div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="sos-btn sos-btn--ghost"
                  onClick={() => setReassignTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="sos-btn sos-btn--primary"
                  disabled={!reassignEmployee || reassignBusy}
                  onClick={() => void handleReassign()}
                >
                  {reassignBusy ? 'Reassigning…' : 'Reassign'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

