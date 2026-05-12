'use client';

import { useEffect, useMemo, useState } from 'react';
import { Inbox as InboxIcon, MessageSquare, Search, Sparkles } from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { listThreads, type ThreadListItem, type WhatsAppThreadStatus } from '@/lib/whatsapp';
import { useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { WhatsAppChatPanel } from '@/components/whatsapp/WhatsAppChatPanel';

type Filter = WhatsAppThreadStatus | 'ALL';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'ALL', label: 'All' },
];

/**
 * Unified WhatsApp inbox for the calling agent. Server scopes the list to
 * threads assigned to the caller's lead unless they hold whatsapp.view_all_inboxes.
 *
 * Layout: filter chips + search → list (left) + chat panel (right).
 */
export default function SalesInboxPage() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { socket } = useWhatsAppSocket();

  const reload = useMemo(
    () => async () => {
      setLoading(true);
      try {
        const res = await listThreads({
          ...(filter !== 'ALL' ? { status: filter } : {}),
          ...(search ? { search } : {}),
        });
        setItems(res.items);
        if (!activeId && res.items.length > 0) setActiveId(res.items[0]!.id);
      } finally {
        setLoading(false);
      }
    },
    [filter, search, activeId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime: when a message arrives anywhere, refresh the list to bump order
  // and update unread counts. The chat panel handles its own per-thread sync.
  useEffect(() => {
    if (!socket) return;
    const onAny = () => {
      void reload();
    };
    socket.on('whatsapp.message.new', onAny);
    socket.on('whatsapp.message.status', onAny);
    return () => {
      socket.off('whatsapp.message.new', onAny);
      socket.off('whatsapp.message.status', onAny);
    };
  }, [socket, reload]);

  const counts = useMemo(() => {
    return {
      open: items.filter((t) => t.status === 'OPEN').length,
      breached: items.filter((t) => t.slaBreached).length,
      unread: items.reduce((acc, t) => acc + t.unreadCount, 0),
    };
  }, [items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp inbox"
        title={
          <>
            Your assigned chats.<br />
            One unified inbox.
          </>
        }
        description="Every WhatsApp conversation routed to you. Filter by status, search by name or phone, and reply without leaving the page."
        meta={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge tone="info" dot>{counts.open} open</StatusBadge>
            <StatusBadge tone="warning" dot>{counts.unread} unread</StatusBadge>
            <StatusBadge tone="danger" dot>{counts.breached} SLA breaches</StatusBadge>
          </div>
        }
        actions={
          <StatusBadge tone="accent" size="lg" icon={<Sparkles size={12} />}>
            Live
          </StatusBadge>
        }
      />

      <section
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)',
          minHeight: 'calc(100vh - 280px)',
        }}
      >
        <GlassCard variant="default" padded={false} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              gap: 6,
              padding: 10,
              borderBottom: '1px solid var(--sos-border-subtle)',
            }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="sos-tab"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                style={{ flex: 1 }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ padding: 10, borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <div className="sos-input-group">
              <span className="sos-input-group__icon"><Search size={14} /></span>
              <input
                type="search"
                className="sos-input"
                placeholder="Name or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div
            className="sos-scroll"
            style={{ flex: 1, overflowY: 'auto', padding: 10 }}
          >
            {loading ? (
              <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>
                Loading conversations…
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                Icon={InboxIcon}
                title="Nothing here yet"
                description="When customers message your business on WhatsApp and the conversation routes to you, it appears here."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((t) => (
                  <ThreadRow
                    key={t.id}
                    item={t}
                    active={activeId === t.id}
                    onClick={() => setActiveId(t.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        {activeId ? (
          <WhatsAppChatPanel threadId={activeId} />
        ) : (
          <GlassCard variant="strong" padded={false} style={{ minHeight: 480 }}>
            <EmptyState
              Icon={MessageSquare}
              title="Select a conversation"
              description="Pick a chat from the list to view and reply."
            />
          </GlassCard>
        )}
      </section>
    </div>
  );
}

function ThreadRow({
  item,
  active,
  onClick,
}: {
  item: ThreadListItem;
  active: boolean;
  onClick: () => void;
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
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
      }}
    >
      <div className={`sos-conv-row ${active ? 'sos-conv-row--active' : ''}`}>
        <div className="sos-avatar">{initials(displayName)}</div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span
              className="sos-title"
              style={{
                fontSize: 'var(--sos-text-base)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 180,
              }}
            >
              {displayName}
            </span>
            {item.lastMessageAt && (
              <span className="sos-text-faint" style={{ fontSize: 'var(--sos-text-xs)', whiteSpace: 'nowrap' }}>
                {formatRelativeShort(item.lastMessageAt)}
              </span>
            )}
          </div>
          <div
            className="sos-text-muted"
            style={{
              fontSize: 'var(--sos-text-sm)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 240,
              marginTop: 2,
            }}
          >
            {item.lastMessagePreview ?? '(no messages yet)'}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <StatusBadge tone={tone(item.status)} size="sm">{item.status.toLowerCase()}</StatusBadge>
            {item.slaBreached && <StatusBadge tone="danger" size="sm">SLA</StatusBadge>}
            {item.unreadCount > 0 && (
              <StatusBadge tone="accent" size="sm">{item.unreadCount} new</StatusBadge>
            )}
          </div>
        </div>
        <div />
      </div>
    </button>
  );
}

function tone(s: ThreadListItem['status']) {
  switch (s) {
    case 'OPEN':
      return 'info' as const;
    case 'PENDING':
      return 'warning' as const;
    case 'RESOLVED':
      return 'success' as const;
    default:
      return 'neutral' as const;
  }
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
