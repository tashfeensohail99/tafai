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

// Three non-overlapping tabs:
//   All         — every chat (newest first)
//   Open        — a human HAS replied (the active, being-handled pile)
//   Uncontacted — NO human has ever replied yet (the to-do list)
// Open + Uncontacted partition All exactly. When a rep first replies, the chat
// moves from Uncontacted → Open automatically (lastHumanReplyAt gets stamped).
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'UNCONTACTED', label: 'Uncontacted' },
];

/**
 * WhatsApp-style unified inbox — full-height split layout matching WhatsApp Web.
 * Left: contact list with search + filter tabs. Right: live chat panel.
 */
export default function SalesInboxPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  // "Due (N)" chip toggle — when on, the list is filtered to chats whose lead
  // has an OPEN follow-up due/overdue now (combines with the active tab).
  const [followUpDueOnly, setFollowUpDueOnly] = useState(false);
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
  }, [filter, debouncedSearch, followUpDueOnly]);

  // Server-side filter per tab. Open = "a human has replied" (contacted);
  // Uncontacted = "no human has ever replied"; All = no filter. The "Due (N)"
  // chip layers an OPEN-follow-up-due filter on top of whichever tab is active.
  const scopeQuery = useCallback(
    () => {
      const base =
        filter === 'UNCONTACTED'
          ? { uncontacted: true as const }
          : filter === 'OPEN'
            ? { contacted: true as const }
            : {};
      return followUpDueOnly ? { ...base, followUpDue: true as const } : base;
    },
    [filter, followUpDueOnly],
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
      // Lazy pagination on every tab: load the first page, then the user pulls
      // more via the "Load more" button or infinite scroll. Re-fetch as many
      // pages as they'd already scrolled to, so a background reconcile (30s /
      // focus) doesn't collapse a scrolled-open list back to the first page.
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
  }, [scopeQuery, debouncedSearch, refreshStats, filter]);

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

  // (Uncontacted full-load is handled atomically inside reload() above — no
  // separate chained-loadMore effect, which could be interrupted mid-chain and
  // leave the list short of the badge.)

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
      if (filter === 'UNCONTACTED') {
        // No human has ever replied. The moment a rep replies, lastHumanReplyAt
        // is stamped → this returns false → the chat drops out of Uncontacted.
        if (row.lastHumanReplyAt != null) return false;
      } else if (filter === 'OPEN') {
        // Open = a human has replied. A freshly-replied chat now matches here →
        // it appears in Open (the "moved to Open" half of the transition).
        if (row.lastHumanReplyAt == null) return false;
      }
      // ALL: no status filter
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

  // Defensive render guard: only show rows that actually match the ACTIVE tab's
  // rule. The list loads server-filtered, but if a row ever goes stale in
  // `items` — e.g. a chat got a human reply *after* it was loaded into the
  // Uncontacted list — this guarantees it can never RENDER under the wrong tab.
  // A contacted chat (lastHumanReplyAt != null) is therefore impossible to show
  // under "Uncontacted", regardless of any cache/refresh timing. Mirrors
  // scopeQuery() and the realtime matches() predicate exactly.
  const visibleItems = useMemo(() => {
    if (filter === 'UNCONTACTED') return items.filter((t) => t.lastHumanReplyAt == null);
    if (filter === 'OPEN') return items.filter((t) => t.lastHumanReplyAt != null);
    return items; // ALL
  }, [items, filter]);

  // Real DB total for the active tab (from stats) — drives the "showing N of M"
  // footer so the loaded list and the tab badge are never confusingly different.
  // Open = contacted = total − uncontacted (the complement of Uncontacted).
  const activeTabTotal = useMemo<number | null>(() => {
    if (!stats) return null;
    // While the "Due follow-ups" overlay is on, the list is a filtered subset
    // that doesn't match any tab total — hide the "of M" so it's not misleading.
    if (followUpDueOnly) return null;
    switch (filter) {
      case 'ALL': return stats.total;
      case 'OPEN': return stats.total - stats.uncontacted;
      case 'UNCONTACTED': return stats.uncontacted;
      default: return null;
    }
  }, [stats, filter, followUpDueOnly]);

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
            // Real DB totals from the stats endpoint — NOT a count of the loaded
            // page. The three tabs partition every chat:
            //   All         → stats.total
            //   Open        → contacted = total − uncontacted (a human replied)
            //   Uncontacted → stats.uncontacted (no human reply ever)
            const count = stats
              ? f.key === 'ALL'
                ? stats.total
                : f.key === 'OPEN'
                  ? stats.total - stats.uncontacted
                  : f.key === 'UNCONTACTED'
                    ? stats.uncontacted
                    : 0
              : // Stats not yet loaded — fall back to page-based count while fetching.
                f.key === 'ALL'
                ? items.length
                : f.key === 'OPEN'
                  ? items.filter((t) => t.lastHumanReplyAt != null).length
                  : items.filter((t) => t.lastHumanReplyAt == null).length;
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
                { term: 'All', desc: 'Every chat, newest first.' },
                { term: 'Open', desc: 'A human has replied at least once — the active, being-handled conversations.' },
                { term: 'Uncontacted', desc: "No human has ever replied — only the AI bot greeted them. Your to-do list. The moment you reply, the chat moves to Open." },
              ]}
            />
          </div>
        </div>

        {/* "Due follow-ups" quick filter — shows how many of your chats have an
            OPEN follow-up due/overdue right now; tap to pull up exactly those
            (layered on top of the active tab). Only rendered when there's
            something due, or while the filter is active so it can be cleared. */}
        {(followUpDueOnly || (stats?.followUpDue ?? 0) > 0) ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderBottom: '1px solid var(--sos-border-subtle)',
              background: 'var(--wa-panel-header)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setFollowUpDueOnly((v) => !v)}
              title="Show only chats with a follow-up due or overdue"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${followUpDueOnly ? 'var(--wa-accent)' : 'var(--sos-border-subtle)'}`,
                background: followUpDueOnly ? 'var(--wa-accent)' : 'transparent',
                color: followUpDueOnly ? '#fff' : 'var(--sos-text-secondary)',
              }}
            >
              ⏰ Due follow-ups{stats ? ` (${stats.followUpDue})` : ''}
            </button>
            {followUpDueOnly ? (
              <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                showing chats with a follow-up due — tap to clear
              </span>
            ) : null}
          </div>
        ) : null}

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
              <div style={{ fontSize: 14 }}>No chats assigned to you yet</div>
            </div>
          ) : (
            <>
              {visibleItems.map((t) => (
                <ThreadRow
                  key={t.id}
                  item={t}
                  active={activeId === t.id}
                  onSelect={handleSelect}
                />
              ))}
              {nextCursor ? (
                // Prominent, obvious "Load more" button (was easy-to-miss muted
                // text). Infinite scroll also fires it, but the button is the
                // reliable manual fallback — esp. when a filtered page is short
                // and the list doesn't scroll on its own.
                <div style={{ padding: 12 }}>
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'center',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--wa-accent)',
                      background: 'transparent',
                      color: 'var(--wa-accent)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: loadingMore ? 'default' : 'pointer',
                    }}
                  >
                    {loadingMore
                      ? `Loading…${activeTabTotal != null ? ` (${visibleItems.length} of ${activeTabTotal})` : ''}`
                      : `Load more${activeTabTotal != null ? ` (${visibleItems.length} of ${activeTabTotal})` : ''}`}
                  </button>
                </div>
              ) : activeTabTotal != null && visibleItems.length > 0 ? (
                // Fully loaded — confirm the list matches the badge (no hidden rows).
                <div
                  style={{
                    textAlign: 'center',
                    padding: '10px 12px',
                    color: 'var(--sos-text-muted)',
                    fontSize: 11.5,
                  }}
                >
                  {visibleItems.length} {visibleItems.length === 1 ? 'chat' : 'chats'} loaded
                </div>
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

  // "Action required": the lead messaged and no human has answered yet, in a
  // chat a human HAS handled before (lastHumanReplyAt set). The sort pins these
  // to the top; the accent bar + "Reply" tag make it obvious WHY they're there.
  const needsReply = item.awaitingReply && item.lastHumanReplyAt != null;
  // Show the time of the last REAL activity (customer msg or rep reply), NOT the
  // last raw message — otherwise a bot "just checking in" nudge would stamp a
  // fresh time on a chat that's correctly sorted lower, making the list look
  // mis-ordered. Falls back to lastMessageAt for bot-only greetings.
  const ts = item.lastHumanActivityAt ?? item.lastMessageAt;

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
          // Action-required chats get a left accent bar so the block pinned to
          // the top reads as "your reply queue". Transparent (not 0) on the rest
          // so text stays aligned across every row.
          borderLeft: needsReply ? '3px solid var(--wa-accent)' : '3px solid transparent',
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
            {ts && (
              <span
                style={{
                  fontSize: 11,
                  color: needsReply || item.unreadCount > 0 ? 'var(--wa-accent)' : 'var(--sos-text-faint)',
                  flexShrink: 0,
                }}
              >
                {formatRelativeShort(ts)}
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
              {needsReply && (
                <span
                  title="The lead replied — you haven't answered yet"
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--wa-accent)',
                    border: '1px solid var(--wa-accent)',
                    borderRadius: 4,
                    padding: '0 5px',
                    lineHeight: '15px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Reply
                </span>
              )}
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
