'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PhoneMissed,
  PhoneIncoming,
  PhoneOutgoing,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';
import {
  getMyCalls,
  getMyMissedCallCount,
  type RepCallItem,
} from '@/lib/whatsapp';

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'missed', label: 'Missed' },
  { key: 'incoming', label: 'Incoming' },
  { key: 'outgoing', label: 'Outgoing' },
];

function filterParams(filter: string): { direction?: string; status?: string } {
  switch (filter) {
    case 'missed':
      return { direction: 'INBOUND', status: 'MISSED' };
    case 'incoming':
      return { direction: 'INBOUND' };
    case 'outgoing':
      return { direction: 'OUTBOUND' };
    default:
      return {};
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '#';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function dur(s: number | null): string {
  if (!s || s <= 0) return '';
  return ` · ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function SalesCallsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState<RepCallItem[]>([]);
  const [missed, setMissed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMyCalls({ limit: 100, ...filterParams(filter) })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => {
    getMyMissedCallCount()
      .then((r) => setMissed(r.count))
      .catch(() => {});
  }, []);

  const grouped = useMemo(() => {
    const out: Array<{ day: string; rows: RepCallItem[] }> = [];
    for (const it of items) {
      const day = dayLabel(it.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(it);
      else out.push({ day, rows: [it] });
    }
    return out;
  }, [items]);

  const open = (it: RepCallItem) => {
    if (it.leadId) router.push(`/sales/leads/${it.leadId}`);
    else router.push('/sales/inbox');
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '4px 0 40px' }}>
      {missed > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--sos-bg-danger, rgba(220,38,38,0.08))',
            border: '0.5px solid var(--sos-border-danger, rgba(220,38,38,0.25))',
            borderRadius: 10,
            padding: '10px 14px',
            margin: '0 0 14px',
          }}
        >
          <PhoneMissed size={18} style={{ color: 'var(--sos-text-danger, #b91c1c)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-danger, #b91c1c)' }}>
            {missed} missed {missed === 1 ? 'call' : 'calls'} in the last 24h — call them back
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                fontSize: 13,
                padding: '6px 14px',
                borderRadius: 16,
                cursor: 'pointer',
                border: active ? 'none' : '0.5px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
                background: active ? 'var(--sos-text-primary, #111827)' : 'transparent',
                color: active ? 'var(--sos-surface-primary, #fff)' : 'var(--sos-text-secondary, #4b5563)',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#b91c1c', padding: 16 }}>
          <AlertTriangle size={18} /> <span>Couldn&apos;t load your calls: {error}</span>
        </div>
      ) : loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
          {filter === 'missed' ? 'No missed calls — nice.' : 'No calls here yet.'}
        </div>
      ) : (
        grouped.map((g) => (
          <div key={g.day}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--sos-text-tertiary, #6b7280)',
                padding: '12px 4px 6px',
              }}
            >
              {g.day}
            </div>
            {g.rows.map((it) => (
              <CallRow key={it.id} item={it} onOpen={() => open(it)} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function CallRow({ item, onOpen }: { item: RepCallItem; onOpen: () => void }) {
  const missed = item.status === 'MISSED';
  const inbound = item.direction === 'INBOUND';
  const connected = item.status === 'ENDED' || item.status === 'ANSWERED';
  const name = item.contactName?.trim() || item.phone || 'Unknown';

  let Icon = PhoneOutgoing;
  let color = 'var(--sos-text-tertiary, #6b7280)';
  let label = 'Outgoing';
  if (missed) {
    Icon = PhoneMissed;
    color = 'var(--sos-text-danger, #b91c1c)';
    label = 'Missed';
  } else if (inbound) {
    Icon = PhoneIncoming;
    color = 'var(--sos-text-success, #15803d)';
    label = 'Incoming';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 4px',
        borderBottom: '0.5px solid var(--sos-border-subtle, rgba(0,0,0,0.06))',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'var(--sos-brand-primary-soft, rgba(37,99,235,0.10))',
          color: 'var(--sos-brand-primary-strong, #2563eb)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {initials(name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: missed ? 'var(--sos-text-danger, #b91c1c)' : 'var(--sos-text-primary, #111827)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--sos-text-secondary, #4b5563)',
            marginTop: 1,
          }}
        >
          <Icon size={14} style={{ color }} />
          <span>
            {label}
            {connected ? dur(item.durationSeconds) : ''} · {timeLabel(item.createdAt)}
          </span>
        </div>
      </div>
      <button
        onClick={onOpen}
        title="Open chat / lead"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          padding: '7px 12px',
          borderRadius: 8,
          cursor: 'pointer',
          border: '0.5px solid var(--sos-border-subtle, rgba(0,0,0,0.14))',
          background: 'transparent',
          color: 'var(--sos-text-secondary, #4b5563)',
        }}
      >
        <MessageSquare size={15} /> Open
      </button>
    </div>
  );
}
