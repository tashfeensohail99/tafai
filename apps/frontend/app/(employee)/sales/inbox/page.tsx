'use client';

import { useEffect, useMemo, useState } from 'react';
import { Inbox as InboxIcon, MessageSquare, Search } from 'lucide-react';
import { listThreads, type ThreadListItem, type WhatsAppThreadStatus } from '@/lib/whatsapp';
import { useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { WhatsAppChatPanel } from '@/components/whatsapp/WhatsAppChatPanel';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';

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

type Filter = WhatsAppThreadStatus | 'ALL';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RESOLVED', label: 'Resolved' },
];

/**
 * WhatsApp-style unified inbox — full-height split layout matching WhatsApp Web.
 * Left: contact list with search + filter tabs. Right: live chat panel.
 */
export default function SalesInboxPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { socket } = useWhatsAppSocket();
  const isMobile = useIsMobile();

  const reload = useMemo(
    () => async () => {
      setLoading(true);
      try {
        const res = await listThreads({
          ...(filter !== 'ALL' ? { status: filter } : {}),
          ...(search ? { search } : {}),
        });
        setItems(res.items);
        // Auto-select first thread on desktop only — on mobile we want the
        // user to land on the list and tap-into a chat.
        if (!activeId && res.items.length > 0 && !isMobile) {
          setActiveId(res.items[0]!.id);
        }
      } finally {
        setLoading(false);
      }
    },
    [filter, search, activeId, isMobile],
  );

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!socket) return;
    const onAny = () => { void reload(); };
    socket.on('whatsapp.message.new', onAny);
    socket.on('whatsapp.message.status', onAny);
    return () => {
      socket.off('whatsapp.message.new', onAny);
      socket.off('whatsapp.message.status', onAny);
    };
  }, [socket, reload]);

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
            const count = f.key === 'ALL' ? items.length : items.filter((t) => t.status === f.key).length;
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

        {/* Thread list */}
        <div
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
            items.map((t) => (
              <ThreadRow
                key={t.id}
                item={t}
                active={activeId === t.id}
                onClick={() => setActiveId(t.id)}
              />
            ))
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
              {item.slaBreached && (
                <span
                  style={{
                    background: '#ef4444',
                    color: '#fff',
                    borderRadius: 6,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 5px',
                  }}
                >
                  SLA
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
