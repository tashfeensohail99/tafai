'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, MinusCircle, Users } from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { listTeamPresence, type TeamPresenceRow } from '@/lib/whatsapp-admin';

/**
 * Manager / admin dashboard — live view of every employee's WhatsApp inbox
 * membership, presence, and open lead load.
 *
 * Auto-refreshes every 15s so the room shows real activity without manual
 * reload. (Future: subscribe to whatsapp.presence.changed over Socket.IO.)
 */
export default function WhatsAppTeamAdminPage() {
  const [team, setTeam] = useState<TeamPresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTeam(await listTeamPresence());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 15_000);
    return () => clearInterval(id);
  }, [reload]);

  const members = team.filter((t) => t.whatsappInboxMember);
  const online = members.filter((t) => t.effective === 'ONLINE').length;
  const away = members.filter((t) => t.effective === 'AWAY').length;
  const offline = members.filter((t) => t.effective === 'OFFLINE').length;
  const totalOpen = members.reduce((acc, t) => acc + t.openLeads, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp · Team"
        title="Inbox team — live"
        description="Every employee in the WhatsApp inbox pool with their current presence and assigned-lead load. Auto-refreshes every 15 seconds."
      />

      <section
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <MetricCard label="Inbox members" value={members.length} hint="whatsappInboxMember = true" tone="accent" Icon={Users} />
        <MetricCard label="Online now" value={online} hint="ONLINE + fresh heartbeat" tone="success" Icon={CheckCircle2} />
        <MetricCard label="Away" value={away} hint="Idle ≥5 min or self-marked" tone="warning" Icon={MinusCircle} />
        <MetricCard label="Offline" value={offline} hint="Not currently routable" tone="neutral" Icon={Circle} />
        <MetricCard label="Open leads (total)" value={totalOpen} hint="Across all inbox members" tone="info" Icon={Users} />
      </section>

      <GlassCard variant="default" padded={false}>
        {loading && team.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Loading team…</div>
        ) : error ? (
          <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>
            <span>{error}</span>
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            Icon={Users}
            title="Nobody in the inbox pool yet"
            description="On the Employee admin page, toggle 'WhatsApp Inbox Member' on for the sales staff who should receive WhatsApp leads."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Header />
            {members.map((t) => (
              <Row key={t.id} row={t} />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function Header() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1.4fr 0.7fr 0.7fr 1fr',
        gap: 16,
        padding: '14px 18px',
        borderBottom: '1px solid var(--sos-border-subtle)',
        fontSize: 'var(--sos-text-xs)',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'var(--sos-text-faint)',
      }}
    >
      <div>Agent</div>
      <div>Skills</div>
      <div>Presence</div>
      <div>Open leads</div>
      <div>Last active</div>
    </div>
  );
}

function Row({ row }: { row: TeamPresenceRow }) {
  const presenceTone =
    row.effective === 'ONLINE' ? 'success' : row.effective === 'AWAY' ? 'warning' : 'neutral';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1.4fr 0.7fr 0.7fr 1fr',
        gap: 16,
        padding: '14px 18px',
        borderBottom: '1px solid var(--sos-border-subtle)',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="sos-avatar">{initials(row.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
            {row.name}
          </div>
          <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
            {row.email}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {row.skills.length === 0 ? (
          <span className="sos-text-faint" style={{ fontSize: 'var(--sos-text-sm)' }}>none</span>
        ) : (
          row.skills.map((s) => (
            <StatusBadge key={s} tone="cyan" size="sm">{s}</StatusBadge>
          ))
        )}
      </div>
      <div>
        <StatusBadge tone={presenceTone} size="sm" dot>{row.effective.toLowerCase()}</StatusBadge>
      </div>
      <div className="sos-text-secondary" style={{ fontSize: 'var(--sos-text-sm)' }}>
        {row.openLeads}
      </div>
      <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
        {row.lastActivityAt ? formatRel(row.lastActivityAt) : '—'}
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function formatRel(iso: string, now = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}
