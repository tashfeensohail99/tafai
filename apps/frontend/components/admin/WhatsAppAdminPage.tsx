'use client';

/**
 * Admin WhatsApp inbox. Mirrors the WhatsApp-Web split-pane layout from the
 * sales inbox (`/sales/inbox`) so the operator UX is the same — click a
 * thread on the left, the conversation opens on the right with full message
 * history, composer, status ticks, etc. Reuses the same WhatsAppChatPanel
 * component the sales page uses; no behaviour drift.
 *
 * On top of the sales layout we layer admin-only powers:
 *   - "Unassigned only" filter chip (see threads no agent owns)
 *   - Per-row Reassign action (compact button at the right of each thread row)
 *   - Top metric strip (active / unassigned / SLA breached counts)
 *   - Reassign modal with team-presence dropdown (online / away / offline tag,
 *     open-leads count per agent)
 *
 * Permission gating:
 *   - whatsapp.view_all_inboxes  → admin sees the page at all
 *   - whatsapp.reassign          → Reassign buttons + modal visible
 *
 * The thread list filter is forwarded to `listThreads()` server-side, including
 * the `unassigned` flag. Realtime updates (`whatsapp.message.new` /
 * `whatsapp.message.status`) re-fetch the list so unread counts and SLA
 * badges stay live across reassigns and incoming messages.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox as InboxIcon,
  MessageSquare,
  RefreshCw,
  Search,
  TimerReset,
  UserCog,
} from 'lucide-react';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import {
  getThreadStats,
  listThreads,
  reassignThread,
  threadMatchesSearch,
  type ThreadListItem,
  type ThreadStats,
  type WhatsAppThreadStatus,
} from '@/lib/whatsapp';
import { listTeamPresence, type TeamPresenceRow } from '@/lib/whatsapp-admin';
import { useThreadListLivePatch, useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { WhatsAppChatPanel } from '@/components/whatsapp/WhatsAppChatPanel';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';

// ────────────────────────────────────────────────────────────────────────────
// Hooks + helpers
// ────────────────────────────────────────────────────────────────────────────

function useIsMobile(threshold = 1024): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setIsMobile(window.innerWidth < threshold);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [threshold]);
  return isMobile;
}

// 'UNCONTACTED' is a virtual filter: pending chats where no human has ever
// replied (the bot greeting doesn't count) — leads awaiting a first sales reply.
type Filter = WhatsAppThreadStatus | 'ALL' | 'UNCONTACTED';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'UNCONTACTED', label: 'Uncontacted' },
  { key: 'RESOLVED', label: 'Resolved' },
];

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

export function WhatsAppAdminPage() {
  const { user } = useAdminSession();
  const canViewAll = user.permissions.includes('whatsapp.view_all_inboxes');
  const canReassign = user.permissions.includes('whatsapp.reassign');

  const [filter, setFilter] = useState<Filter>('ALL');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  // Admin filter: '' = all agents, otherwise an employeeId to scope the list to
  // that agent's assigned conversations (e.g. "Iffat's chats").
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  // Debounced copy — only triggers a fetch after typing pauses 300ms, so a
  // 5-char query is one round-trip instead of five. Matches /sales/inbox.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [team, setTeam] = useState<TeamPresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Pagination — the list endpoint is cursor-paginated; we load the first
  // page on filter change and append further pages as the user scrolls.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // True inbox counters from the dedicated /stats endpoint — replaces the
  // old items.length which capped every chip at the 30-item page size.
  const [stats, setStats] = useState<ThreadStats | null>(null);
  // Bigger first page so the list feels full before scroll kicks in.
  const PAGE_SIZE = 50;
  const { socket } = useWhatsAppSocket();
  const isMobile = useIsMobile();

  // Reassign modal state
  const [reassignTarget, setReassignTarget] = useState<ThreadListItem | null>(null);
  const [reassignEmployee, setReassignEmployee] = useState<string>('');
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Debounce the search box — see debouncedSearch above.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Shared list-query args built from the current filter state. Used by the
  // full reload, the realtime soft-refresh, and infinite-scroll paging so the
  // three never drift. PENDING maps to needsReply (awaitingReply=true) —
  // no thread row is ever written with status=PENDING.
  const buildQuery = useCallback(
    (cursor?: string) => ({
      ...(filter === 'PENDING'
        ? { needsReply: true as const }
        : filter === 'UNCONTACTED'
          ? { uncontacted: true as const }
          : filter !== 'ALL'
            ? { status: filter }
            : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(unassignedOnly ? { unassigned: true } : {}),
      ...(agentFilter ? { employeeId: agentFilter } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    }),
    [filter, debouncedSearch, unassignedOnly, agentFilter],
  );

  // Refetch the thread list + stats — the two things a new/updated message
  // changes. NO loading spinner: this runs silently from realtime events so
  // the list updates in place without a flash. Stats failure is non-fatal.
  const refreshThreads = useCallback(async () => {
    if (!canViewAll) return;
    const [t, st] = await Promise.all([
      listThreads(buildQuery()),
      getThreadStats().catch(() => null),
    ]);
    setItems(t.items);
    setNextCursor(t.nextCursor);
    if (st) setStats(st);
  }, [canViewAll, buildQuery]);

  // Team presence changes only on (re)assignment, never on a message — so it
  // gets its own fetcher and is deliberately left OUT of the per-message
  // refresh path. That alone removes 2/3 of the old realtime query volume.
  const refreshPresence = useCallback(async () => {
    if (!canViewAll) return;
    const p = await listTeamPresence().catch(() => [] as TeamPresenceRow[]);
    setTeam(p);
  }, [canViewAll]);

  // Stats only (the KPI chips) — no list fetch, so the periodic reconcile can
  // refresh the chip counts without resetting a scrolled-down list.
  const refreshStats = useCallback(async () => {
    if (!canViewAll) return;
    const st = await getThreadStats().catch(() => null);
    if (st) setStats(st);
  }, [canViewAll]);

  // Full reload WITH the loading spinner — initial mount, filter/search
  // change, manual Refresh, post-reassign. Deps deliberately exclude activeId
  // / isMobile so clicking a thread doesn't recreate this and refire the
  // effect below (that was a full 3-query refetch on every chat selection).
  const reload = useCallback(async () => {
    if (!canViewAll) return;
    setLoading(true);
    try {
      await Promise.all([refreshThreads(), refreshPresence()]);
    } finally {
      setLoading(false);
    }
  }, [canViewAll, refreshThreads, refreshPresence]);

  // Stable row handlers so memo(ThreadRow) can skip re-rendering every row on
  // each list update — only the rows whose `active` flag flips re-render.
  const handleSelect = useCallback((id: string) => setActiveId(id), []);
  const openReassign = useCallback((t: ThreadListItem) => {
    setReassignTarget(t);
    setReassignEmployee('');
    setReassignError(null);
  }, []);

  // Append the next page when the user scrolls near the bottom of the list.
  // Guarded so we never fire two in-flight loads or load past the end.
  const loadMore = useCallback(async () => {
    if (!canViewAll || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const t = await listThreads(buildQuery(nextCursor));
      // De-dupe by id in case a realtime refresh raced with the append.
      setItems((curr) => {
        const seen = new Set(curr.map((i) => i.id));
        return [...curr, ...t.items.filter((i) => !seen.has(i.id))];
      });
      setNextCursor(t.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [canViewAll, nextCursor, loadingMore, buildQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Auto-select the first thread on desktop — own effect so it fires once on
  // initial load, not on every reload.
  useEffect(() => {
    if (!activeId && !isMobile && items.length > 0) {
      setActiveId(items[0]!.id);
    }
  }, [items, activeId, isMobile]);

  // Realtime: patch only the thread(s) a socket event touches instead of
  // refetching all 50 + stats + presence on every message. The single-row
  // fetch re-applies the admin's view-all scope, and membership against the
  // active filter (status / Pending / unassigned / agent / search) is checked
  // here so a thread that leaves the filter (e.g. just got assigned while on
  // the Unassigned tab) is dropped.
  //   - interval reconcile → chips + presence only (no list fetch, so a
  //     scrolled list isn't reset every 30s)
  //   - focus reconcile → full list + chips + presence for total correctness
  useThreadListLivePatch({
    socket,
    setItems,
    matches: (row) => {
      if (unassignedOnly && row.lead?.assignedEmployeeId) return false;
      if (agentFilter && row.lead?.assignedEmployeeId !== agentFilter) return false;
      if (filter === 'PENDING') {
        // Pending = follow-ups: awaiting a reply AND a human replied before.
        if (!row.awaitingReply || row.lastHumanReplyAt == null) return false;
      } else if (filter === 'UNCONTACTED') {
        if (!row.awaitingReply || row.lastHumanReplyAt != null) return false;
      } else if (filter !== 'ALL') {
        if (row.status !== filter) return false;
      }
      return debouncedSearch ? threadMatchesSearch(row, debouncedSearch) : true;
    },
    reconcile: () => {
      void refreshStats();
      void refreshPresence();
    },
    reconcileOnFocus: () => {
      void refreshThreads();
      void refreshPresence();
    },
    // Keep the KPI chips (Pending / overdue / unassigned …) live with each
    // burst of activity, not only on the 30s reconcile — so a reply visibly
    // drops "Pending" the moment it clears the thread.
    onActivity: () => void refreshStats(),
  });

  // Auto-clear confirmation banner after 4 seconds so it doesn't linger.
  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 4000);
    return () => clearTimeout(t);
  }, [confirmation]);

  // KPI numbers come from the /stats endpoint (true totals). Fall back to
  // the loaded page only while stats are still loading, so the chips never
  // show a blank.
  const activeCount = stats?.active ?? items.length;
  const unassignedCount = stats?.unassigned ?? items.filter((t) => !t.lead?.assignedEmployeeId).length;
  // Response-SLA numbers (the source of truth). The legacy first-response
  // "SLA breached" KPI was retired — it only scored the conversation's first
  // reply and disagreed with these rolling figures, which confused the team.
  const overdueCount = stats?.overdue ?? 0;
  const approachingCount = stats?.approaching ?? 0;
  const slaScore = stats?.slaScore ?? null;
  const totalUnread = stats?.unread ?? items.reduce((acc, t) => acc + t.unreadCount, 0);

  // Defensive render guard: only show rows matching the ACTIVE tab's rule, so a
  // stale row (e.g. a chat that got a human reply after it was loaded into the
  // Uncontacted list) can never render under the wrong tab. Mirrors scopeQuery.
  const visibleItems = useMemo(() => {
    if (filter === 'ALL') return items;
    if (filter === 'PENDING') return items.filter((t) => t.awaitingReply && t.lastHumanReplyAt != null);
    if (filter === 'UNCONTACTED') return items.filter((t) => t.awaitingReply && t.lastHumanReplyAt == null);
    return items.filter((t) => t.status === filter);
  }, [items, filter]);

  const eligibleTeam = useMemo(
    () => team.filter((t) => t.whatsappInboxMember).sort((a, b) => a.name.localeCompare(b.name)),
    [team],
  );

  async function handleReassign() {
    if (!reassignTarget || !reassignEmployee) return;
    setReassignBusy(true);
    setReassignError(null);
    try {
      const result = await reassignThread(reassignTarget.id, reassignEmployee);
      setConfirmation(`Reassigned to ${result.assignedEmployeeName}.`);
      setReassignTarget(null);
      setReassignEmployee('');
      void reload();
    } catch (err) {
      setReassignError(err instanceof Error ? err.message : 'Reassign failed');
    } finally {
      setReassignBusy(false);
    }
  }

  if (!canViewAll) return <PermissionDeniedState />;

  // Mobile single-pane: when a chat is selected we show only the chat;
  // back button returns to the list. On desktop both panes stay visible.
  const showList = !isMobile || activeId === null;
  const showChat = !isMobile || activeId !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header strip — title + admin metrics + refresh */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow" style={{ marginBottom: 4 }}>
            WhatsApp · Admin
          </div>
          <h1 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', margin: 0 }}>
            All conversations
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <AdminMetricChip
            label="Active"
            value={activeCount}
            tone="info"
            icon={<MessageSquare size={12} />}
          />
          <AdminMetricChip
            label="Unassigned"
            value={unassignedCount}
            tone={unassignedCount > 0 ? 'warning' : 'neutral'}
            icon={<AlertTriangle size={12} />}
          />
          <AdminMetricChip
            label="Overdue"
            value={overdueCount}
            tone={overdueCount > 0 ? 'danger' : 'neutral'}
            icon={<AlertTriangle size={12} />}
          />
          <AdminMetricChip
            label="Approaching"
            value={approachingCount}
            tone={approachingCount > 0 ? 'warning' : 'neutral'}
            icon={<TimerReset size={12} />}
          />
          <AdminMetricChip
            label="SLA score"
            value={slaScore === null ? '—' : `${slaScore}%`}
            tone={
              slaScore === null
                ? 'neutral'
                : slaScore >= 90
                  ? 'info'
                  : slaScore >= 75
                    ? 'warning'
                    : 'danger'
            }
            icon={<CheckCircle2 size={12} />}
          />
          <button
            type="button"
            onClick={() => void reload()}
            className="sos-btn sos-btn--ghost"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5 }}
            title="Refresh"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {confirmation ? (
        <div className="sos-banner sos-banner--success" style={{ fontSize: 13 }}>
          {confirmation}
        </div>
      ) : null}

      {/* WhatsApp-Web split-pane */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'minmax(0, 1fr)'
            : 'minmax(280px, 340px) minmax(0, 1fr)',
          height: 'calc(100vh - 200px)',
          minHeight: 540,
          overflow: 'hidden',
          border: '1px solid var(--sos-border-subtle)',
          borderRadius: 12,
          background: 'var(--sos-surface-1)',
          minWidth: 0,
        }}
      >
        {/* ── Left panel: contact list ── */}
        {showList ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              borderRight: isMobile ? 'none' : '1px solid var(--sos-border-subtle)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--wa-panel-header)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: 'var(--wa-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  WA
                </div>
                <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--sos-text-primary)' }}>
                  All inboxes
                </span>
                {totalUnread > 0 && (
                  <span
                    style={{
                      background: 'var(--wa-accent)',
                      color: '#fff',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '1px 7px',
                      lineHeight: '18px',
                    }}
                  >
                    {totalUnread}
                  </span>
                )}
              </div>
            </div>

            {/* Search */}
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--wa-panel-header)',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--wa-composer-input-bg)',
                  borderRadius: 8,
                  padding: '6px 12px',
                }}
              >
                <Search size={15} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
                <input
                  type="search"
                  placeholder="Search name or phone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--sos-text-primary)',
                    fontSize: 14,
                  }}
                />
              </div>
            </div>

            {/* Filter tabs */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--sos-border-subtle)',
                background: 'var(--wa-panel-header)',
                flexShrink: 0,
              }}
            >
              {FILTERS.map((f) => {
                const active = filter === f.key;
                // True totals from /threads/stats so the chips never cap at
                // the page size. Fall back to the loaded page only while
                // stats is still loading.
                const count = stats
                  ? f.key === 'ALL'
                    ? stats.total
                    : f.key === 'OPEN'
                      ? stats.active
                      : f.key === 'PENDING'
                        ? Math.max(0, stats.awaitingReply - stats.uncontacted)
                        : f.key === 'UNCONTACTED'
                          ? stats.uncontacted
                          : f.key === 'RESOLVED'
                            ? stats.resolved
                            : 0
                  : f.key === 'ALL'
                    ? items.length
                    : items.filter((t) => t.status === f.key).length;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      border: 'none',
                      borderBottom: active ? '2px solid var(--wa-accent)' : '2px solid transparent',
                      background: 'transparent',
                      color: active ? 'var(--wa-accent)' : 'var(--sos-text-muted)',
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    {f.label}
                    {count > 0 && (
                      <span
                        style={{
                          background: active ? 'var(--wa-accent)' : 'var(--sos-border-subtle)',
                          color: active ? '#fff' : 'var(--sos-text-muted)',
                          borderRadius: 8,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '0 5px',
                          lineHeight: '16px',
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Admin-only: Unassigned-only toggle row */}
            <div
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid var(--sos-border-subtle)',
                background: 'var(--wa-panel-header)',
                flexShrink: 0,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--sos-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={unassignedOnly}
                  onChange={(e) => {
                    setUnassignedOnly(e.target.checked);
                    // Mutually exclusive with the per-agent filter.
                    if (e.target.checked) setAgentFilter('');
                  }}
                />
                Unassigned only
                {unassignedOnly && unassignedCount > 0 ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      color: 'var(--sos-text-faint)',
                    }}
                  >
                    {unassignedCount} match
                  </span>
                ) : null}
              </label>
            </div>

            {/* Admin-only: filter the list by assigned agent (e.g. "Iffat's chats") */}
            <div
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid var(--sos-border-subtle)',
                background: 'var(--wa-panel-header)',
                flexShrink: 0,
              }}
            >
              <select
                value={agentFilter}
                onChange={(e) => {
                  setAgentFilter(e.target.value);
                  // Mutually exclusive with the unassigned-only toggle.
                  if (e.target.value) setUnassignedOnly(false);
                }}
                style={{
                  width: '100%',
                  fontSize: 12,
                  padding: '6px 8px',
                  background: 'var(--wa-composer-input-bg)',
                  color: 'var(--sos-text-primary)',
                  border: '1px solid var(--sos-border-subtle)',
                  borderRadius: 6,
                  outline: 'none',
                  cursor: 'pointer',
                }}
                title="Show conversations assigned to a specific agent"
              >
                <option value="">All agents</option>
                {[...team]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.whatsappInboxMember ? '' : ' (not in pool)'}
                    </option>
                  ))}
              </select>
            </div>

            {/* Thread list */}
            <div
              className="sos-scroll"
              style={{ flex: 1, overflowY: 'auto', background: 'var(--sos-surface-1)' }}
              onScroll={(e) => {
                // Infinite scroll — when the user is within 240px of the
                // bottom, pull the next cursor page. Cheap threshold check;
                // loadMore() is self-guarding against double-fires.
                const el = e.currentTarget;
                if (
                  nextCursor &&
                  !loadingMore &&
                  el.scrollHeight - el.scrollTop - el.clientHeight < 240
                ) {
                  void loadMore();
                }
              }}
            >
              {loading && items.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--sos-text-muted)',
                    fontSize: 13,
                  }}
                >
                  Loading conversations…
                </div>
              ) : visibleItems.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: 12,
                    color: 'var(--sos-text-muted)',
                    padding: 32,
                    textAlign: 'center',
                  }}
                >
                  <InboxIcon size={40} strokeWidth={1} />
                  <div style={{ fontSize: 14 }}>No conversations match these filters.</div>
                </div>
              ) : (
                visibleItems.map((t) => (
                  <ThreadRow
                    key={t.id}
                    item={t}
                    active={activeId === t.id}
                    canReassign={canReassign}
                    onSelect={handleSelect}
                    onReassign={openReassign}
                  />
                ))
              )}

              {/* Load-more footer: spinner while fetching the next page,
                  or a subtle "all caught up" marker once fully loaded. */}
              {items.length > 0 ? (
                <div
                  style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: 11.5,
                    color: 'var(--sos-text-faint)',
                  }}
                >
                  {loadingMore
                    ? 'Loading more…'
                    : nextCursor
                      ? 'Scroll for more'
                      : `${items.length} conversation${items.length === 1 ? '' : 's'} loaded`}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ── Right panel: chat ── */}
        {showChat ? (
          activeId ? (
            <WhatsAppChatPanel
              threadId={activeId}
              hideSidePanel
              onBack={isMobile ? () => setActiveId(null) : undefined}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                background: 'var(--wa-chat-bg)',
                color: 'var(--sos-text-muted)',
              }}
            >
              <MessageSquare size={56} strokeWidth={0.8} />
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--sos-text-secondary)' }}>
                All conversations
              </div>
              <div style={{ fontSize: 13, maxWidth: 280, textAlign: 'center' }}>
                Select a conversation from the list to view messages, reply, or reassign.
              </div>
            </div>
          )
        ) : null}
      </div>

      {/* ── Reassign modal ── */}
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
            style={{
              width: '100%',
              maxWidth: 480,
              padding: 0,
              borderRadius: 'var(--sos-radius-panel)',
            }}
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
                  <option value="" disabled>
                    Pick a WhatsApp inbox member…
                  </option>
                  {eligibleTeam.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{' '}
                      {m.effective === 'ONLINE'
                        ? '(online)'
                        : m.effective === 'AWAY'
                          ? '(away)'
                          : '(offline)'}{' '}
                      · {m.openLeads} open
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
                The selected agent also becomes this lead's sticky preference — any future
                inbound on the same number will come back to them.
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

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function AdminMetricChip({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  tone: 'info' | 'warning' | 'danger' | 'neutral';
  icon?: React.ReactNode;
}) {
  const bg =
    tone === 'info'
      ? 'var(--sos-status-info-soft)'
      : tone === 'warning'
        ? 'var(--sos-status-warning-soft)'
        : tone === 'danger'
          ? 'var(--sos-status-danger-soft)'
          : 'var(--sos-surface-2)';
  const fg =
    tone === 'info'
      ? 'var(--sos-status-info-strong)'
      : tone === 'warning'
        ? 'var(--sos-status-warning-strong)'
        : tone === 'danger'
          ? 'var(--sos-status-danger-strong)'
          : 'var(--sos-text-secondary)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: bg,
        color: fg,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
      <span
        style={{
          background: 'var(--sos-surface-0)',
          color: fg,
          borderRadius: 10,
          padding: '0 6px',
          fontSize: 11,
          lineHeight: '16px',
        }}
      >
        {value}
      </span>
    </div>
  );
}

const ThreadRow = memo(function ThreadRow({
  item,
  active,
  canReassign,
  onSelect,
  onReassign,
}: {
  item: ThreadListItem;
  active: boolean;
  canReassign: boolean;
  onSelect: (id: string) => void;
  onReassign: (item: ThreadListItem) => void;
}) {
  const displayName =
    item.client?.firstName || item.client?.lastName
      ? `${item.client.firstName} ${item.client.lastName}`.trim()
      : item.lead
        ? `${item.lead.firstName} ${item.lead.lastName}`.trim()
        : item.waContactId;

  const assignedName = item.lead?.assignedEmployee
    ? `${item.lead.assignedEmployee.firstName} ${item.lead.assignedEmployee.lastName}`.trim()
    : null;

  return (
    <div
      onClick={() => onSelect(item.id)}
      style={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px 10px 16px',
        background: active ? 'var(--wa-composer-input-bg)' : 'transparent',
        borderBottom: '1px solid var(--sos-border-subtle)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--wa-panel-header)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          background: avatarColor(displayName),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {initials(displayName)}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 4,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 14,
              fontWeight: item.unreadCount > 0 ? 600 : 400,
              color: 'var(--sos-text-primary)',
              overflow: 'hidden',
              maxWidth: 200,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 170,
              }}
            >
              {displayName}
            </span>
            {item.lead?.importRows && item.lead.importRows.length > 0 ? (
              <CsvLeadBadge
                batchName={item.lead.importRows[0]?.batch.name}
                compact
              />
            ) : null}
            {item.adReferral ? (
              <span
                title={
                  item.adReferral.headline
                    ? `From ad: ${item.adReferral.headline}`
                    : 'From WhatsApp ad'
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(24,119,242,0.20)',
                  color: '#5b9dff',
                  border: '1px solid rgba(24,119,242,0.35)',
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}
              >
                {item.adReferral.media_type === 'video' ? '▶ Ad' : 'Ad'}
              </span>
            ) : null}
          </span>
          {item.lastMessageAt && (
            <span
              style={{
                fontSize: 10.5,
                color: item.unreadCount > 0 ? 'var(--wa-accent)' : 'var(--sos-text-faint)',
                flexShrink: 0,
              }}
            >
              {formatRelativeShort(item.lastMessageAt)}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 2,
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: 'var(--sos-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
          >
            {item.lastMessagePreview ?? ''}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {item.unreadCount > 0 && (
              <span
                style={{
                  background: 'var(--wa-accent)',
                  color: '#fff',
                  borderRadius: 10,
                  minWidth: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '0 5px',
                }}
              >
                {item.unreadCount}
              </span>
            )}
          </div>
        </div>

        {/* Assignment line (admin context: always visible so it's clear who
            owns each thread without having to open it). Unassigned threads
            get an attention pill so they stand out at a glance. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 3,
            fontSize: 11,
          }}
        >
          {assignedName ? (
            <span style={{ color: 'var(--sos-text-faint)' }}>→ {assignedName}</span>
          ) : (
            <span
              style={{
                color: '#b45309',
                background: 'rgba(245, 158, 11, 0.12)',
                padding: '0 5px',
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              Unassigned
            </span>
          )}
        </div>
      </div>

      {canReassign ? (
        <button
          type="button"
          aria-label="Reassign thread"
          title="Reassign thread"
          onClick={(e) => {
            e.stopPropagation();
            onReassign(item);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--sos-text-muted)',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--sos-surface-2)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-muted)';
          }}
        >
          <UserCog size={15} />
        </button>
      ) : null}
    </div>
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Visual helpers
// ────────────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'var(--wa-accent)',
  '#0099cc',
  '#9c27b0',
  '#e91e63',
  '#ff5722',
  '#607d8b',
  '#795548',
];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function formatRelativeShort(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
