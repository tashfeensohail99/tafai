'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Inbox as InboxIcon, MessageSquare, Search } from 'lucide-react';
import {
  getThreadStats,
  listThreads,
  threadMatchesSearch,
  type ThreadListItem,
  type ThreadStats,
  type WhatsAppThreadStatus,
} from '@/lib/whatsapp';
import { useThreadListLivePatch, useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { WhatsAppChatPanel } from '@/components/whatsapp/WhatsAppChatPanel';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { InfoHint } from '@/components/common/InfoHint';

/** Hook: track viewport width so we can switch to single-pane on mobile. */
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

// 'UNCONTACTED' is a virtual filter (not a thread status): chats awaiting a
// human reply where NO human has ever replied — the bot greeting doesn't count.
type Filter = WhatsAppThreadStatus | 'ALL' | 'UNCONTACTED';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'UNCONTACTED', label: 'Uncontacted' },
  { key: 'RESOLVED', label: 'Resolved' },
];

/**
 * WhatsApp-style unified inbox — full-height split layout matching WhatsApp Web.
 * Left: contact list with search + filter tabs. Right: live chat panel.
 */
export default function SalesInboxPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Real DB counts for the tab badges — fetched from the stats endpoint so
  // they reflect the full table (All / Open / Pending / Resolved), NOT just
  // the 100 threads loaded on the current page.
  const [stats, setStats] = useState<ThreadStats | null>(null);
  // How many pages we've loaded — so the 30s/focus reconcile re-fetches the
  // same depth instead of collapsing the list back to the first 100.
  const pagesRef = useRef(1);
  const { socket } = useWhatsAppSocket();
  const isMobile = useIsMobile();
  // Debounce: only fetch after typing pauses for 300ms. Without this, every
  // keystroke fires a backend round-trip — typing "Awais" used to send 5
  // requests, each ~600-900ms.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // useCallback (not useMemo) and deps WITHOUT activeId / isMobile so clicking
  // a chat doesn't recreate the function and refire the useEffect below —
  // that was burning a full thread-list refetch on every selection click.
  // `background: true` skips the loading spinner — used by realtime refreshes
  // so an incoming message updates the list in place without a flash. Foreground
  // (initial load, filter/search change) still shows the skeleton.
  // Filter/search change → reset pagination depth back to page 1 AND clear
  // the cursor. Bug: without the cursor reset, loadMore() passed the previous
  // filter's cursor to the new filter's query and fetched the wrong threads.
  useEffect(() => {
    pagesRef.current = 1;
    setNextCursor(null);
  }, [filter, debouncedSearch]);

  // The "Pending" tab maps to needsReply (awaitingReply=true) — the literal
  // WhatsAppThreadStatus.PENDING value is never written by any code path, so
  // filtering by status='PENDING' would always return zero.
  const scopeQuery = useCallback(
    () =>
      filter === 'PENDING'
        ? { needsReply: true }
        : filter === 'UNCONTACTED'
          ? { uncontacted: true }
          : filter !== 'ALL'
            ? { status: filter }
            : {},
    [filter],
  );

  // Fetch just the tab counts without reloading the thread list.
  // Used by the realtime reconcile so counts stay live without full refetches.
  const refreshStats = useCallback(async () => {
    try {
      setStats(await getThreadStats());
    } catch {
      /* non-critical — existing counts stay */
    }
  }, []);

  const reload = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    // Fetch stats in parallel — always use the real DB totals for tab badges.
    void refreshStats();
    try {
      const scope = scopeQuery();
      const searchPart = debouncedSearch ? { search: debouncedSearch } : {};
      // Re-fetch as many pages as the agent had scrolled to, so a background
      // reconcile (every 30s / on focus) doesn't collapse the list back to the
      // first 100 — it preserves the full scrolled-open inbox.
      const pages = Math.max(1, pagesRef.current);
      let acc: ThreadListItem[] = [];
      let cursor: string | undefined;
      let last: string | null = null;
      for (let i = 0; i < pages; i++) {
        const res = await listThreads({ ...scope, ...searchPart, limit: 100, ...(cursor ? { cursor } : {}) });
        if (i === 0) {
          acc = res.items;
        } else {
          const seen = new Set(acc.map((t) => t.id));
          acc = [...acc, ...res.items.filter((t) => !seen.has(t.id))];
        }
        last = res.nextCursor;
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      setItems(acc);
      setNextCursor(last);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [scopeQuery, debouncedSearch, refreshStats]);

  useEffect(() => { void reload(); }, [reload]);

  // Load the next page of OLDER chats (cursor pagination). Appends + dedupes,
  // and remembers the new depth so the reconcile keeps it.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listThreads({
        ...scopeQuery(),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        limit: 100,
        cursor: nextCursor,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...res.items.filter((t) => !seen.has(t.id))];
      });
      setNextCursor(res.nextCursor);
      pagesRef.current = Math.min(pagesRef.current + 1, 40); // cap ~4000 chats
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, scopeQuery, debouncedSearch]);

  // Infinite scroll: load older chats when the list nears the bottom.
  const onListScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (nextCursor && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < 280) {
        void loadMore();
      }
    },
    [nextCursor, loadingMore, loadMore],
  );

  // Auto-select first thread on desktop only — moved out of `reload` so it
  // only happens once on initial mount, not after every reload.
  useEffect(() => {
    if (!activeId && !isMobile && items.length > 0) {
      setActiveId(items[0]!.id);
    }
  }, [items, activeId, isMobile]);

  // Realtime: patch only the thread(s) a socket event touches instead of
  // refetching all 100 — the touched chat updates in place and jumps to the
  // top, WhatsApp-style. The 30s/focus reconcile is the self-healing net.
  // Membership is checked client-side here; the backend single-row fetch
  // still re-applies this agent's own-leads scope, so it stays safe.
  useThreadListLivePatch({
    socket,
    setItems,
    matches: (row) => {
      if (filter === 'PENDING') {
        if (!row.awaitingReply) return false;
      } else if (filter === 'UNCONTACTED') {
        // Awaiting a human reply AND no human has ever replied (bot greeting only).
        if (!row.awaitingReply || row.lastHumanReplyAt != null) return false;
      } else if (filter !== 'ALL') {
        if (row.status !== filter) return false;
      }
      return debouncedSearch ? threadMatchesSearch(row, debouncedSearch) : true;
    },
    reconcile: () => void reload({ background: true }),
    // Keep the tab counts (All / Open / Pending / Resolved) live with each
    // burst of activity — so replying to a chat drops "Pending" within a
    // beat, not only on the slow 30s reconcile. refreshStats() fetches the
    // real DB totals (now no-store) without reloading the whole list.
    onActivity: () => void refreshStats(),
  });

  // Stable handler so memo(ThreadRow) skips re-rendering unaffected rows when
  // the list updates — only the rows whose `active` flag flips re-render.
  const handleSelect = useCallback((id: string) => setActiveId(id), []);

  const totalUnread = useMemo(() => items.reduce((acc, t) => acc + t.unreadCount, 0), [items]);

  // Mobile single-pane: when a chat is selected we show only the chat;
  // back button returns to the list. On desktop both panes stay visible.
  const showList = !isMobile || activeId === null;
  const showChat = !isMobile || activeId !== null;

  return (
    <div
      style={{
        display: 'grid',
        // Tablet (≤1023px): single pane; the useIsMobile hook now triggers
        // at 1024px so iPad portrait + small laptops also get the WhatsApp-
        // mobile flow. Desktop: 320px list + chat (was 360px — gives the
        // chat more breathing room).
        gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(280px, 320px) minmax(0, 1fr)',
        height: 'calc(100vh - 64px)',
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
              Inbox
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
              placeholder="Search or start new chat"
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
            // Use real DB totals from the stats endpoint — NOT a count of the
            // loaded page (which caps at 100 and makes All=100, Open=100 look
            // identical even when there are 500+ conversations).
            //   All  → stats.total  (every thread this rep can see)
            //   Open → stats.active (status=OPEN)
            //   Pending → stats.awaitingReply (awaitingReply column)
            //   Resolved → stats.resolved (status=RESOLVED)
            const count = stats
              ? f.key === 'ALL'
                ? stats.total
                : f.key === 'PENDING'
                  ? stats.awaitingReply
                  : f.key === 'UNCONTACTED'
                    ? stats.uncontacted
                    : f.key === 'OPEN'
                      ? stats.active
                      : f.key === 'RESOLVED'
                        ? stats.resolved
                        : 0
              : // Stats not yet loaded — fall back to page-based count while fetching.
                f.key === 'ALL'
                ? items.length
                : f.key === 'PENDING'
                  ? items.filter((t) => t.awaitingReply).length
                  : f.key === 'UNCONTACTED'
                    ? items.filter((t) => t.awaitingReply && t.lastHumanReplyAt == null).length
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
          {/* ⓘ — hover explains what each tab means */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', color: 'var(--sos-text-muted)' }}>
            <InfoHint
              align="right"
              width={300}
              title="What these tabs mean"
              items={[
                { term: 'Open', desc: 'Active conversations (not resolved).' },
                { term: 'Pending', desc: "Awaiting your reply — the customer messaged after your last reply (the bot's replies don't count). = Uncontacted + follow-ups." },
                { term: 'Uncontacted', desc: "You've never replied — only the AI bot greeted them. Needs your first reply." },
                { term: 'Resolved', desc: "Conversations you've marked done." },
              ]}
            />
          </div>
        </div>

        {/* Thread list */}
        <div
          onScroll={onListScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            background: 'var(--sos-surface-1)',
          }}
        >
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
              Loading chats…
            </div>
          ) : items.length === 0 ? (
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
              <div style={{ fontSize: 14 }}>No chats assigned to you yet</div>
            </div>
          ) : (
            <>
              {items.map((t) => (
                <ThreadRow
                  key={t.id}
                  item={t}
                  active={activeId === t.id}
                  onSelect={handleSelect}
                />
              ))}
              {nextCursor ? (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  style={{
                    all: 'unset',
                    display: 'block',
                    width: '100%',
                    textAlign: 'center',
                    padding: 12,
                    cursor: loadingMore ? 'default' : 'pointer',
                    color: 'var(--sos-text-muted)',
                    fontSize: 12.5,
                  }}
                >
                  {loadingMore ? 'Loading older chats…' : 'Load older chats'}
                </button>
              ) : null}
            </>
          )}
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
            WhatsApp Inbox
          </div>
          <div style={{ fontSize: 13, maxWidth: 280, textAlign: 'center' }}>
            Select a conversation from the list to start messaging
          </div>
        </div>
      )
      ) : null}
    </div>
  );
}

const ThreadRow = memo(function ThreadRow({
  item,
  active,
  onSelect,
}: {
  item: ThreadListItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const displayName =
    item.client?.firstName || item.client?.lastName
      ? `${item.client.firstName} ${item.client.lastName}`.trim()
      : item.lead
        ? `${item.lead.firstName} ${item.lead.lastName}`.trim()
        : item.waContactId;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
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
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: avatarColor(displayName),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {initials(displayName)}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 15,
                fontWeight: item.unreadCount > 0 ? 600 : 400,
                color: 'var(--sos-text-primary)',
                overflow: 'hidden',
                maxWidth: 210,
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 180,
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
                  fontSize: 11,
                  color: item.unreadCount > 0 ? 'var(--wa-accent)' : 'var(--sos-text-faint)',
                  flexShrink: 0,
                }}
              >
                {formatRelativeShort(item.lastMessageAt)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 4 }}>
            <span
              style={{
                fontSize: 13,
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
        </div>
      </div>
    </button>
  );
});

function tone(s: ThreadListItem['status']) {
  switch (s) {
    case 'OPEN': return 'info' as const;
    case 'PENDING': return 'warning' as const;
    case 'RESOLVED': return 'success' as const;
    default: return 'neutral' as const;
  }
}

const AVATAR_COLORS = ['var(--wa-accent)', '#0099cc', '#9c27b0', '#e91e63', '#ff5722', '#607d8b', '#795548'];
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
