'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  XCircle,
} from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import {
  fmtRelative,
  getNotifications,
  type PortalNotification,
} from '@/lib/portal';

const ICON_MAP: Record<PortalNotification['kind'], React.ElementType> = {
  UNREAD_MESSAGE: MessageSquare,
  MISSING_DOCUMENT: FileText,
  REJECTED_DOCUMENT: XCircle,
  EXPIRING_DOCUMENT: AlertTriangle,
  UPCOMING_APPOINTMENT: CalendarClock,
  STAGE_CHANGE: CheckCircle2,
};

const SEVERITY_TONE: Record<
  PortalNotification['severity'],
  { fg: string; bg: string; border: string }
> = {
  info: {
    fg: 'var(--sos-status-info)',
    bg: 'var(--sos-status-info-soft)',
    border: 'var(--sos-status-info-border)',
  },
  warning: {
    fg: 'var(--sos-status-warning)',
    bg: 'var(--sos-status-warning-soft)',
    border: 'var(--sos-status-warning-border)',
  },
  danger: {
    fg: 'var(--sos-status-danger)',
    bg: 'var(--sos-status-danger-soft)',
    border: 'var(--sos-status-danger-border)',
  },
  success: {
    fg: 'var(--sos-status-success)',
    bg: 'var(--sos-status-success-soft)',
    border: 'var(--sos-status-success-border)',
  },
};

function NotificationRow({ n }: { n: PortalNotification }) {
  const Icon = ICON_MAP[n.kind] ?? Bell;
  const colors = SEVERITY_TONE[n.severity];
  return (
    <Link href={n.href as Route} style={{ textDecoration: 'none' }}>
      <GlassCard
        variant="panel"
        padded="md"
        style={{
          cursor: 'pointer',
          borderLeft: `3px solid ${colors.fg}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              color: colors.fg,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: 3 }}>
              {n.title}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)' }}>
              {n.body}
            </div>
            <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={11} />
              {fmtRelative(n.createdAt)}
            </div>
          </div>
          <ArrowRight size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0, marginTop: 4 }} />
        </div>
      </GlassCard>
    </Link>
  );
}

export function ClientNotificationsPage() {
  const [items, setItems] = useState<PortalNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getNotifications()
      .then((rows) => setItems(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load notifications'));
  }, []);

  if (error) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>;
  }
  if (!items) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading notifications…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0, marginBottom: 4 }}>
          Notifications
        </h1>
        <div style={{ fontSize: 13.5, color: 'var(--sos-text-muted)' }}>
          Everything that needs your attention, in one place
        </div>
      </div>

      {items.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 16 }}>
            <Bell size={28} style={{ color: 'var(--sos-text-muted)', opacity: 0.4 }} />
            <div className="sos-text-muted" style={{ textAlign: 'center', fontSize: 13.5 }}>
              You're all caught up. Nothing needs your attention right now.
            </div>
          </div>
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((n) => <NotificationRow key={n.id} n={n} />)}
        </div>
      )}
    </div>
  );
}
