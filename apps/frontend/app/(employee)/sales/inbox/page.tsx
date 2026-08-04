'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  Ban,
  FileText,
  Image as ImageIcon,
  Inbox as InboxIcon,
  MapPin,
  MessageSquare,
  Mic,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Search,
  ShieldOff,
  Sticker,
  User,
  Video,
} from 'lucide-react';
import {
  archiveThread,
  blockContact,
  getThreadStats,
  listThreads,
  pinThread,
  searchThreadMessages,
  threadMatchesSearch,
  unarchiveThread,
  unblockContact,
  unpinThread,
  type MessageSearchResult,
  type ThreadListItem,
  type ThreadStats,
} from '@/lib/whatsapp';
import { useSession } from '@/lib/session';
import { useThreadListLivePatch, useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { WhatsAppChatPanel } from '@/components/whatsapp/WhatsAppChatPanel';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { InfoHint } from '@/components/common/InfoHint';
import { DispositionChip } from '@/components/whatsapp/DispositionChip';
import { DispositionPickerModal } from '@/components/whatsapp/DispositionPickerModal';
import { DispositionFilterChip } from '@/components/whatsapp/DispositionFilterChip';
import type { LeadDisposition } from '@/lib/whatsapp';
import { Tag } from 'lucide-react';

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

// WhatsApp-style filter chips. 'UNREAD' = literal WhatsApp unread (unreadCount>0,
// clears when the rep opens the chat). 'UNCONTACTED' = no human has ever replied
// (bot greeting doesn't count). 'BLOCKED' = an exclusive view. 'ARCHIVED' is NOT
// a chip — it's the dedicated "Archived N" row above the list (WhatsApp-style).
type Filter = 'ALL' | 'UNREAD' | 'UNCONTACTED' | 'ARCHIVED' | 'BLOCKED';

// The chip bar (Archived is deliberately absent — it's its own top row):
//   All         — every ACTIVE chat (newest message first; archived + blocked hidden)
//   Unread      — chats the rep hasn't opened since the last inbound
//   Uncontacted — NO human has ever replied yet (first-touch to-do list)
//   Blocked     — contacts the rep blocked
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'UNREAD', label: 'Unread' },
  { key: 'UNCONTACTED', label: 'Uncontacted' },
  { key: 'BLOCKED', label: 'Blocked' },
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
  // Disposition funnel — when set, the list is scoped to chats whose lead
  // carries this sales disposition (stacks with the active tab). Mirrors the
  // mobile inbox's disposition filter chip.
  const [dispositionFilter, setDispositionFilter] = useState<LeadDisposition | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // #4 content search — chats matched by MESSAGE TEXT (not just name/phone).
  const [msgResults, setMsgResults] = useState<MessageSearchResult[]>([]);
  const [msgSearchBusy, setMsgSearchBusy] = useState(false);
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Row-level Set-Disposition modal — opened from the ⋮ row menu.
  // Lifted here so the modal renders once at the page root, above overflow.
  const [dispositionTarget, setDispositionTarget] = useState<{
    leadId: string;
    current: LeadDisposition | null;
    threadId: string;
  } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Real DB counts for the tab badges — fetched from the stats endpoint so
  // they reflect the full table (All / Open / Pending / Resolved), NOT just
  // the 100 threads loaded on the current page.
  const [stats, setStats] = useState<ThreadStats | null>(null);
  // How many pages we've loaded — so the 30s/focus reconcile re-fetches the
  // same depth instead of collapsing the list back to the first 100.
  const pagesRef = useRef(1);
  // Focused by the header "+" (new chat) — WhatsApp's "+" opens contact search;
  // ours jumps the rep straight into the search box to find the contact.
  const searchRef = useRef<HTMLInputElement>(null);
  const { socket } = useWhatsAppSocket();
  const isMobile = useIsMobile();
  const session = useSession();
  const canBlock =
    session.status === 'authed' && session.user.permissions.includes('whatsapp.block');
  // Sales reps can archive their own threads (same perm the backend archive
  // endpoint requires).
  const canArchive =
    session.status === 'authed' && session.user.permissions.includes('whatsapp.send_message');
  // Pinning is a PERSONAL action — anyone who can see the inbox may pin their
  // own chats (no extra permission), so it's gated only on being signed in.
  const canPin = session.status === 'authed';
  // Per-row pending id + transient banner for archive/block actions.
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Block confirm dialog target (mirrors the admin Block dialog, lightweight).
  const [blockTarget, setBlockTarget] = useState<ThreadListItem | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
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
  }, [filter, debouncedSearch, followUpDueOnly, dispositionFilter]);

  // Server-side filter per tab. Open = "a human has replied" (contacted);
  // Uncontacted = "no human has ever replied"; All = no filter. The "Due (N)"
  // chip layers an OPEN-follow-up-due filter on top of whichever tab is active.
  const scopeQuery = useCallback(
    () => {
      // Funnel model: "All" = ENGAGED (a human has replied); "Unread" = engaged
      // AND unread. A never-contacted lead lives only in "Uncontacted" until a
      // rep replies, then it graduates into All.
      const base =
        filter === 'UNCONTACTED'
          ? { uncontacted: true as const }
          : filter === 'UNREAD'
            ? { contacted: true as const, unread: true as const }
            : filter === 'ARCHIVED'
              ? { archived: true as const }
              : filter === 'BLOCKED'
                ? { blocked: true as const }
                : { contacted: true as const };
      const withDue = followUpDueOnly ? { ...base, followUpDue: true as const } : base;
      // Disposition stacks (AND) on top of whichever tab is active.
      return dispositionFilter ? { ...withDue, disposition: dispositionFilter } : withDue;
    },
    [filter, followUpDueOnly, dispositionFilter],
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

  // #4 content search: find chats by what was SAID (message text). Fires on the
  // same debounced query, only in the working tabs (Archived/Blocked are their
  // own views). Cleared when the query is too short. Cancels stale responses so
  // a fast typer never sees an earlier query's results land last.
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q.length < 2 || filter === 'ARCHIVED' || filter === 'BLOCKED') {
      setMsgResults([]);
      setMsgSearchBusy(false);
      return;
    }
    let cancelled = false;
    setMsgSearchBusy(true);
    searchThreadMessages(q)
      .then((res) => { if (!cancelled) setMsgResults(res.items); })
      .catch(() => { if (!cancelled) setMsgResults([]); })
      .finally(() => { if (!cancelled) setMsgSearchBusy(false); });
    return () => { cancelled = true; };
  }, [debouncedSearch, filter]);

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

  // #2 chat-during-call: open a specific thread when the agent arrives from the
  // CallDock "Open chat" deep-link (?thread=<id>, fresh mount) OR a live
  // wa:open-chat event (inbox already mounted — swap the active thread without
  // dropping the call). Runs once; WhatsAppChatPanel loads the thread by id even
  // if it isn't in the loaded list yet.
  useEffect(() => {
    const fromQuery =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('thread')
        : null;
    if (fromQuery) setActiveId(fromQuery);
    const onOpenChat = (e: Event) => {
      const id = (e as CustomEvent).detail?.threadId as string | undefined;
      if (id) setActiveId(id);
    };
    window.addEventListener('wa:open-chat', onOpenChat);
    return () => window.removeEventListener('wa:open-chat', onOpenChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: patch only the thread(s) a socket event touches instead of
  // refetching all 100 — the touched chat updates in place and jumps to the
  // top, WhatsApp-style. The 30s/focus reconcile is the self-healing net.
  // Membership is checked client-side here; the backend single-row fetch
  // still re-applies this agent's own-leads scope, so it stays safe.
  useThreadListLivePatch({
    socket,
    setItems,
    matches: (row) => {
      // JUNK / DEAD leads are excluded from every active view (backend list +
      // stats drop them). Guard the live-patch too so a socket event can't
      // splice one back in between reconciles. (Backend getListItem also returns
      // null for these, so this is belt-and-suspenders.)
      if (row.lead?.disposition === 'JUNK' || row.lead?.disposition === 'DEAD') return false;
      if (filter === 'ARCHIVED') {
        if (row.status !== 'ARCHIVED') return false;
      } else if (filter === 'BLOCKED') {
        // Blocked membership isn't derivable from a list-item; let the 30s/focus
        // reconcile (a full server-filtered refetch) own this tab.
        return false;
      } else {
        // Active tabs (All / Open / Uncontacted) exclude archived threads.
        if (row.status === 'ARCHIVED') return false;
        if (filter === 'UNCONTACTED') {
          // No human has ever replied. The moment a rep replies, lastHumanReplyAt
          // is stamped → this returns false → the chat drops out of Uncontacted.
          if (row.lastHumanReplyAt != null) return false;
        } else {
          // Funnel: ALL and UNREAD are both ENGAGED-only — a chat only enters
          // once a human has replied (before that it lives in Uncontacted).
          if (row.lastHumanReplyAt == null) return false;
          // UNREAD additionally requires unread; opening it (markRead) drops it.
          if (filter === 'UNREAD' && row.unreadCount === 0) return false;
        }
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
  // Also optimistically clears the row's unread badge: opening a thread marks it
  // read on the backend (WhatsAppChatPanel → markThreadRead), so the count drops
  // immediately, WhatsApp-style, instead of lingering until the next reconcile —
  // this is what makes the "Unread" chip's clear-on-open feel instant.
  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setItems((prev) =>
      prev.map((t) => (t.id === id && t.unreadCount > 0 ? { ...t, unreadCount: 0 } : t)),
    );
  }, []);

  // Archive / unarchive one of the rep's own threads, then refresh so the row
  // leaves/enters the active list per the current tab.
  const handleArchive = useCallback(
    async (t: ThreadListItem) => {
      setRowBusyId(t.id);
      try {
        if (t.status === 'ARCHIVED') {
          await unarchiveThread(t.id);
          setNotice('Conversation unarchived.');
        } else {
          await archiveThread(t.id);
          setNotice('Conversation archived.');
        }
        await reload({ background: true });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Archive failed');
      } finally {
        setRowBusyId(null);
      }
    },
    [reload],
  );

  // Pin / unpin one of MY chats to the top of the inbox (personal, max 6). On
  // success reload so the row jumps to (or leaves) the pinned section. A cap
  // rejection surfaces as a notice ("You can pin up to 6 chats…").
  const handlePin = useCallback(
    async (t: ThreadListItem) => {
      setRowBusyId(t.id);
      try {
        if (t.isPinnedByMe) {
          await unpinThread(t.id);
          setNotice('Chat unpinned.');
        } else {
          await pinThread(t.id);
          setNotice('Chat pinned to top.');
        }
        await reload({ background: true });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Pin failed');
      } finally {
        setRowBusyId(null);
      }
    },
    [reload],
  );

  // Unblock straight from a row (the safe direction — no confirm needed).
  const handleUnblock = useCallback(
    async (t: ThreadListItem) => {
      setRowBusyId(t.id);
      try {
        await unblockContact(t.id);
        setNotice('Contact unblocked.');
        await reload({ background: true });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Unblock failed');
      } finally {
        setRowBusyId(null);
      }
    },
    [reload],
  );

  const openBlock = useCallback((t: ThreadListItem) => {
    setBlockTarget(t);
    setBlockReason('');
    setBlockError(null);
  }, []);

  /** Row ⋮ → "Set disposition" — only valid for lead-backed rows. */
  const openDisposition = useCallback((t: ThreadListItem) => {
    if (!t.lead) return;
    setDispositionTarget({
      leadId: t.lead.id,
      current: t.lead.disposition ?? null,
      threadId: t.id,
    });
  }, []);

  /** Patch the local thread list so the row chip updates instantly. */
  const handleDispositionSaved = useCallback((d: LeadDisposition) => {
    const target = dispositionTarget;
    if (!target) return;
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== target.threadId || !row.lead) return row;
        return {
          ...row,
          lead: {
            ...row.lead,
            disposition: d,
            dispositionAt: new Date().toISOString(),
          },
        };
      }),
    );
  }, [dispositionTarget]);

  async function handleBlock() {
    if (!blockTarget) return;
    setBlockBusy(true);
    setBlockError(null);
    try {
      await blockContact(blockTarget.id, blockReason.trim() || undefined);
      setNotice('Contact blocked and conversation archived.');
      setBlockTarget(null);
      setBlockReason('');
      void reload({ background: true });
    } catch (err) {
      setBlockError(err instanceof Error ? err.message : 'Block failed');
    } finally {
      setBlockBusy(false);
    }
  }

  // Auto-clear the transient action notice.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  // Prefer the real DB unread total (stats) so the header badge is truthful even
  // before every page is loaded; fall back to summing the loaded rows while
  // stats are still fetching.
  const totalUnread = useMemo(
    () => stats?.unread ?? items.reduce((acc, t) => acc + t.unreadCount, 0),
    [stats, items],
  );

  // Defensive render guard: only show rows that actually match the ACTIVE tab's
  // rule. The list loads server-filtered, but if a row ever goes stale in
  // `items` — e.g. a chat got a human reply *after* it was loaded into the
  // Uncontacted list — this guarantees it can never RENDER under the wrong tab.
  // A contacted chat (lastHumanReplyAt != null) is therefore impossible to show
  // under "Uncontacted", regardless of any cache/refresh timing. Mirrors
  // scopeQuery() and the realtime matches() predicate exactly.
  const visibleItems = useMemo(() => {
    // Keep MY pinned chats at the very top of the working tabs, preserving their
    // server order. The server already returns them first, but the realtime
    // patch can reorder on new activity — this makes "pinned on top" hold
    // regardless. Only applied to the working tabs (not Archived/Blocked).
    const pinnedFirst = (rows: ThreadListItem[]): ThreadListItem[] => {
      const pinned = rows.filter((t) => t.isPinnedByMe);
      if (pinned.length === 0) return rows;
      return [...pinned, ...rows.filter((t) => !t.isPinnedByMe)];
    };
    if (filter === 'ARCHIVED') return items.filter((t) => t.status === 'ARCHIVED');
    // BLOCKED rows arrive pre-filtered from the server; trust the loaded page.
    if (filter === 'BLOCKED') return items;
    const active = items.filter((t) => t.status !== 'ARCHIVED');
    if (filter === 'UNCONTACTED') return pinnedFirst(active.filter((t) => t.lastHumanReplyAt == null));
    if (filter === 'UNREAD') {
      // Funnel Unread = engaged (a human replied) AND unread. Keep the currently-
      // open chat visible even after opening it zeroed its badge, so the active
      // row doesn't vanish mid-read.
      return pinnedFirst(active.filter(
        (t) => (t.unreadCount > 0 && t.lastHumanReplyAt != null) || t.id === activeId,
      ));
    }
    // ALL = engaged only (a human has replied). New leads live in Uncontacted
    // until a rep replies. Keep the open chat visible even if it isn't engaged.
    return pinnedFirst(active.filter((t) => t.lastHumanReplyAt != null || t.id === activeId));
  }, [items, filter, activeId]);

  // #4 content search — are we in a message-content search? Message matches are
  // shown in a separate "Messages" section, deduped against the name-match list
  // above (a chat whose NAME matched shouldn't also repeat under Messages).
  const isSearching =
    debouncedSearch.trim().length >= 2 && filter !== 'ARCHIVED' && filter !== 'BLOCKED';
  const messageMatches = useMemo(() => {
    if (!isSearching) return [];
    const shown = new Set(visibleItems.map((t) => t.id));
    return msgResults.filter((m) => !shown.has(m.id));
  }, [isSearching, msgResults, visibleItems]);

  // Real DB total for the active tab (from stats) — drives the "showing N of M"
  // footer so the loaded list and the tab badge are never confusingly different.
  // Open = contacted = total − uncontacted (the complement of Uncontacted).
  const activeTabTotal = useMemo<number | null>(() => {
    if (!stats) return null;
    // While the "Due follow-ups" overlay is on, the list is a filtered subset
    // that doesn't match any tab total — hide the "of M" so it's not misleading.
    if (followUpDueOnly) return null;
    switch (filter) {
      case 'ALL': return stats.total - stats.uncontacted; // engaged only
      case 'UNREAD': return stats.unreadEngaged;
      case 'UNCONTACTED': return stats.uncontacted;
      case 'ARCHIVED': return stats.archived;
      case 'BLOCKED': return stats.blocked;
      default: return null;
    }
  }, [stats, filter, followUpDueOnly]);

  // Live count for each chip badge — real DB totals from stats, with a
  // page-based fallback while stats are still loading.
  const chipCount = useCallback(
    (key: Filter): number => {
      if (stats) {
        switch (key) {
          case 'ALL': return stats.total - stats.uncontacted; // engaged only
          case 'UNREAD': return stats.unreadEngaged;
          case 'UNCONTACTED': return stats.uncontacted;
          case 'BLOCKED': return stats.blocked;
          case 'ARCHIVED': return stats.archived;
          default: return 0;
        }
      }
      switch (key) {
        case 'ALL': return items.filter((t) => t.lastHumanReplyAt != null).length;
        case 'UNREAD':
          return items.filter((t) => t.unreadCount > 0 && t.lastHumanReplyAt != null).length;
        case 'UNCONTACTED': return items.filter((t) => t.lastHumanReplyAt == null).length;
        case 'ARCHIVED': return items.filter((t) => t.status === 'ARCHIVED').length;
        default: return 0;
      }
    },
    [stats, items],
  );

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
            <span
              style={{
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: '-0.01em',
                color: 'var(--sos-text-primary)',
              }}
            >
              Chats
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
          {/* WhatsApp's "+" opens contact search; ours focuses the search box so
              the rep can look up the contact to start/continue a chat. */}
          <button
            type="button"
            aria-label="New chat"
            title="New chat"
            onClick={() => searchRef.current?.focus()}
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--wa-accent)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Plus size={18} />
          </button>
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
              ref={searchRef}
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

        {/* Filter chips — WhatsApp-style rounded pills with live counts */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--sos-border-subtle)',
            background: 'var(--wa-panel-header)',
            flexShrink: 0,
            overflowX: 'auto',
          }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = chipCount(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 13px',
                  borderRadius: 16,
                  border: `1px solid ${active ? 'var(--wa-accent)' : 'var(--sos-border-subtle)'}`,
                  background: active ? 'var(--wa-accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--sos-text-secondary)',
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.label}
                {count > 0 ? (
                  <span style={{ fontWeight: 700, opacity: active ? 1 : 0.75 }}>{count}</span>
                ) : null}
              </button>
            );
          })}
          {/* Disposition funnel — filter chats by their lead's sales
              disposition (mobile parity). Stacks with the active tab. */}
          <DispositionFilterChip value={dispositionFilter} onChange={setDispositionFilter} />
          {/* ⓘ — hover explains what each chip means */}
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 6,
              color: 'var(--sos-text-muted)',
            }}
          >
            <InfoHint
              align="right"
              width={300}
              title="What these filters mean"
              items={[
                { term: 'All', desc: 'Your engaged chats — the ones a rep has replied to at least once, newest first. New leads live in Uncontacted until you reply, then move here.' },
                { term: 'Unread', desc: "Engaged chats where the customer wrote again and you haven't opened them yet. Opening one clears it — even if it just says “thanks”." },
                { term: 'Uncontacted', desc: 'Brand-new leads no human has replied to yet — your first-touch queue. Reply once and the chat graduates to All.' },
                { term: 'Blocked', desc: 'Contacts you blocked. Their chats stay out of the active list until you unblock them.' },
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

        {/* Archived — WhatsApp-style top row (not a chip). Tap to view archived
            chats; tap again while viewing to return to All. Shown whenever there
            are archived chats, or while the archived view is open. */}
        {filter === 'ARCHIVED' || (stats?.archived ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => setFilter((f) => (f === 'ARCHIVED' ? 'ALL' : 'ARCHIVED'))}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '11px 16px',
              border: 'none',
              borderBottom: '1px solid var(--sos-border-subtle)',
              background: filter === 'ARCHIVED' ? 'var(--wa-composer-input-bg)' : 'transparent',
              cursor: 'pointer',
              flexShrink: 0,
              width: '100%',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 46,
                display: 'flex',
                justifyContent: 'center',
                color: 'var(--sos-text-secondary)',
                flexShrink: 0,
              }}
            >
              {filter === 'ARCHIVED' ? <ArchiveRestore size={20} /> : <Archive size={20} />}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: filter === 'ARCHIVED' ? 600 : 500,
                color: 'var(--sos-text-primary)',
              }}
            >
              {filter === 'ARCHIVED' ? 'Archived — back to chats' : 'Archived'}
            </span>
            {filter !== 'ARCHIVED' && (stats?.archived ?? 0) > 0 ? (
              <span style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>{stats?.archived}</span>
            ) : null}
          </button>
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
          ) : visibleItems.length === 0 && messageMatches.length === 0 && !msgSearchBusy ? (
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
              <div style={{ fontSize: 14 }}>
                {isSearching
                  ? `No chats or messages match “${debouncedSearch.trim()}”`
                  : 'No chats assigned to you yet'}
              </div>
            </div>
          ) : (
            <>
              {visibleItems.length > 0 && isSearching && messageMatches.length > 0 ? (
                <SearchSectionLabel label="Chats" />
              ) : null}
              {visibleItems.map((t) => (
                <ThreadRow
                  key={t.id}
                  item={t}
                  active={activeId === t.id}
                  canBlock={canBlock}
                  canArchive={canArchive}
                  canPin={canPin}
                  blockedView={filter === 'BLOCKED'}
                  busy={rowBusyId === t.id}
                  onSelect={handleSelect}
                  onBlock={openBlock}
                  onUnblock={handleUnblock}
                  onArchive={handleArchive}
                  onPin={handlePin}
                  onSetDisposition={openDisposition}
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

              {/* #4 "Messages" section — chats matched by MESSAGE TEXT (deduped
                  against the name-match list above). WhatsApp-style. */}
              {isSearching && (messageMatches.length > 0 || msgSearchBusy) ? (
                <>
                  <SearchSectionLabel label="Messages" />
                  {msgSearchBusy && messageMatches.length === 0 ? (
                    <div style={{ padding: '10px 16px', color: 'var(--sos-text-muted)', fontSize: 12.5 }}>
                      Searching messages…
                    </div>
                  ) : null}
                  {messageMatches.map((m) => (
                    <MessageResultRow
                      key={`msg-${m.id}`}
                      item={m}
                      query={debouncedSearch.trim()}
                      active={activeId === m.id}
                      onSelect={handleSelect}
                    />
                  ))}
                </>
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

      {/* Transient action notice (archive / block / unblock). Fixed so it floats
          above the split-pane without shifting layout. */}
      {notice ? (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: 'var(--sos-surface-2)',
            color: 'var(--sos-text-primary)',
            border: '1px solid var(--sos-border-subtle)',
            borderRadius: 999,
            padding: '8px 16px',
            fontSize: 13,
            boxShadow: 'var(--sos-shadow-md, 0 6px 24px rgba(0,0,0,0.18))',
          }}
        >
          {notice}
        </div>
      ) : null}

      {/* Disposition picker — opened from the row ⋮ menu (mobile parity).
          Rendered at the page root so it sits above list overflow / z-index. */}
      {dispositionTarget ? (
        <DispositionPickerModal
          open={!!dispositionTarget}
          leadId={dispositionTarget.leadId}
          current={dispositionTarget.current}
          onClose={() => setDispositionTarget(null)}
          onSaved={handleDispositionSaved}
        />
      ) : null}

      {/* Block confirm dialog */}
      {blockTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBlockTarget(null);
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
            style={{ width: '100%', maxWidth: 460, padding: 0, borderRadius: 'var(--sos-radius-panel)' }}
          >
            <header style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>
                Block contact
              </div>
              <div className="sos-text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {blockTarget.lead
                  ? `${blockTarget.lead.firstName} ${blockTarget.lead.lastName} · ${blockTarget.lead.phone}`
                  : blockTarget.client
                    ? `${blockTarget.client.firstName} ${blockTarget.client.lastName} · ${blockTarget.client.phone}`
                    : blockTarget.waContactId}
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
                  Reason (optional)
                </span>
                <textarea
                  className="sos-input"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. spam / abusive / wrong number"
                  style={{ resize: 'vertical' }}
                />
              </label>
              <div
                style={{
                  fontSize: 12,
                  padding: '8px 10px',
                  background: 'var(--sos-status-danger-soft)',
                  border: '1px solid var(--sos-status-danger-border)',
                  borderRadius: 'var(--sos-radius-sm)',
                  color: 'var(--sos-status-danger-strong)',
                }}
              >
                Blocking marks this contact as blocked and archives the conversation. It
                won't appear in your active inbox until you unblock it.
              </div>
              {blockError ? <div className="sos-banner sos-banner--danger">{blockError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="sos-btn sos-btn--ghost" onClick={() => setBlockTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="sos-btn sos-btn--danger"
                  disabled={blockBusy}
                  onClick={() => void handleBlock()}
                >
                  {blockBusy ? 'Blocking…' : 'Block contact'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ThreadRow = memo(function ThreadRow({
  item,
  active,
  canBlock,
  canArchive,
  canPin,
  blockedView,
  busy,
  onSelect,
  onBlock,
  onUnblock,
  onArchive,
  onPin,
  onSetDisposition,
}: {
  item: ThreadListItem;
  active: boolean;
  canBlock: boolean;
  canArchive: boolean;
  canPin: boolean;
  /** True under the BLOCKED tab — the row offers Unblock, not Block. */
  blockedView: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onBlock: (item: ThreadListItem) => void;
  onUnblock: (item: ThreadListItem) => void;
  onArchive: (item: ThreadListItem) => void;
  onPin: (item: ThreadListItem) => void;
  /** Opens the disposition picker for this row's lead. Not offered for
   *  client-only rows (converted contacts have no lead to tag). */
  onSetDisposition: (item: ThreadListItem) => void;
}) {
  const displayName =
    item.client?.firstName || item.client?.lastName
      ? `${item.client.firstName} ${item.client.lastName}`.trim()
      : item.lead
        ? `${item.lead.firstName} ${item.lead.lastName}`.trim()
        : item.waContactId;

  const isArchived = item.status === 'ARCHIVED';

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
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      style={{ cursor: 'pointer', display: 'block', width: '100%' }}
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
              {renderPreview(item.lastMessagePreview)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {/* Disposition chip — mirrors the mobile inbox. Shows the tag
                  colour if set; a dashed "+ Tag" affordance when unset (only
                  for lead-backed rows — converted contacts have no lead to
                  tag). Clicking opens the picker without opening the chat. */}
              {item.lead ? (
                <DispositionChip
                  disposition={item.lead.disposition ?? null}
                  emptyLabel="Tag"
                  onClick={() => onSetDisposition(item)}
                />
              ) : null}
              {item.isPinnedByMe && (
                <Pin
                  size={12}
                  fill="currentColor"
                  aria-label="Pinned"
                  style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }}
                />
              )}
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

        {/* Per-row actions tucked behind a three-dot menu — keeps the row clean
            (the open Archive/Block icons were noisy). The menu stops propagation
            so opening it / picking an action doesn't also open the chat. */}
        {canArchive || canBlock || canPin || item.lead ? (
          <RowActionsMenu
            item={item}
            isArchived={isArchived}
            blockedView={blockedView}
            canArchive={canArchive}
            canBlock={canBlock}
            canPin={canPin}
            busy={busy}
            onArchive={onArchive}
            onBlock={onBlock}
            onUnblock={onUnblock}
            onPin={onPin}
            onSetDisposition={onSetDisposition}
          />
        ) : null}
      </div>
    </div>
  );
});

/** Three-dot row menu → Pin/Archive + Set-disposition + Mark-as-Junk(block)/Unblock.
 *  Keeps the inbox row clean instead of showing the action icons openly. */
function RowActionsMenu({
  item,
  isArchived,
  blockedView,
  canArchive,
  canBlock,
  canPin,
  busy,
  onArchive,
  onBlock,
  onUnblock,
  onPin,
  onSetDisposition,
}: {
  item: ThreadListItem;
  isArchived: boolean;
  blockedView: boolean;
  canArchive: boolean;
  canBlock: boolean;
  canPin: boolean;
  busy: boolean;
  onArchive: (item: ThreadListItem) => void;
  onBlock: (item: ThreadListItem) => void;
  onUnblock: (item: ThreadListItem) => void;
  onSetDisposition: (item: ThreadListItem) => void;
  onPin: (item: ThreadListItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-label="Conversation actions"
        title="More"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (!busy) setOpen((o) => !o);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--sos-text-muted)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          padding: 6,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MoreVertical size={16} />
      </button>
      {open ? (
        <div
          role="menu"
          className="sos-glass sos-glass--strong"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 184,
            borderRadius: 10,
            zIndex: 60,
            overflow: 'hidden',
            padding: 4,
          }}
        >
          {item.lead ? (
            <RowMenuItem
              icon={<Tag size={15} />}
              label="Set disposition"
              onClick={() => run(() => onSetDisposition(item))}
            />
          ) : null}
          {canPin ? (
            <RowMenuItem
              icon={item.isPinnedByMe ? <PinOff size={15} /> : <Pin size={15} />}
              label={item.isPinnedByMe ? 'Unpin chat' : 'Pin chat'}
              onClick={() => run(() => onPin(item))}
            />
          ) : null}
          {canArchive ? (
            <RowMenuItem
              icon={isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              label={isArchived ? 'Unarchive' : 'Archive'}
              onClick={() => run(() => onArchive(item))}
            />
          ) : null}
          {canBlock ? (
            blockedView ? (
              <RowMenuItem
                icon={<ShieldOff size={15} />}
                label="Unblock contact"
                onClick={() => run(() => onUnblock(item))}
              />
            ) : (
              <RowMenuItem
                icon={<Ban size={15} />}
                label="Mark as Junk"
                danger
                onClick={() => run(() => onBlock(item))}
              />
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A single action row inside RowActionsMenu. */
function RowMenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '8px 10px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        color: danger ? 'var(--sos-status-danger-strong)' : 'var(--sos-text-primary)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--sos-surface-2)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** Small uppercase header separating "Chats" from "Messages" in search results. */
function SearchSectionLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '10px 16px 4px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--sos-text-muted)',
        background: 'var(--sos-surface-1)',
      }}
    >
      {label}
    </div>
  );
}

/** A content-search result: avatar + name + the matched message snippet with the
 *  query highlighted. Clicking opens the chat (same handler as a normal row). */
function MessageResultRow({
  item,
  query,
  active,
  onSelect,
}: {
  item: MessageSearchResult;
  query: string;
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
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      style={{ cursor: 'pointer', display: 'block', width: '100%' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          background: active ? 'var(--wa-composer-input-bg)' : 'transparent',
          borderBottom: '1px solid var(--sos-border-subtle)',
        }}
        onMouseEnter={(e) => {
          if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--wa-panel-header)';
        }}
        onMouseLeave={(e) => {
          if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 500,
              color: 'var(--sos-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--sos-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {highlightMatch(item.searchSnippet, query)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Render `text` with case-insensitive occurrences of `q` wrapped in an accent
 *  span — the WhatsApp search-highlight look. */
function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <span key={key++} style={{ color: 'var(--wa-accent)', fontWeight: 700 }}>
        {text.slice(idx, idx + q.length)}
      </span>,
    );
    i = idx + q.length;
  }
  return out;
}

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

/**
 * Render a WhatsApp-style last-message preview. The backend denormalizes media
 * messages into bracket tokens (`[image]`, `[video]`, `[audio]`, `[document: x]`,
 * `[sticker]`, `[location]`, `[reaction 👍]` — see previewOf() in the webhook
 * ingest processor); this maps them to a small glyph + label ("📷 Photo",
 * "🎤 Voice message", …) so the row reads like the real app instead of showing
 * a raw "[image]". Plain text passes straight through.
 */
function renderPreview(preview: string | null): React.ReactNode {
  if (!preview) return '';
  // Reactions carry an emoji after a space (not a colon), e.g. "[reaction 👍]".
  const react = preview.match(/^\[reaction\s+([\s\S]+)\]$/i);
  if (react) return `Reacted ${react[1]}`;
  // Every other token is a single word with an optional ": detail" (documents).
  const m = preview.match(/^\[([a-z]+)(?::\s*([\s\S]+))?\]$/i);
  if (!m) return preview; // plain text — show as-is
  const kind = m[1]!.toLowerCase();
  const rest = m[2]?.trim();
  const glyph = (
    Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>,
    label: string,
  ) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon size={13} style={{ flexShrink: 0 }} />
      {label}
    </span>
  );
  switch (kind) {
    case 'image': return glyph(ImageIcon, 'Photo');
    case 'video': return glyph(Video, 'Video');
    case 'audio': return glyph(Mic, 'Voice message');
    case 'document': return glyph(FileText, rest || 'Document');
    case 'sticker': return glyph(Sticker, 'Sticker');
    case 'location': return glyph(MapPin, 'Location');
    case 'contacts':
    case 'contact': return glyph(User, 'Contact');
    // interactive / unknown single-word tokens — title-case, no stray brackets.
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}
