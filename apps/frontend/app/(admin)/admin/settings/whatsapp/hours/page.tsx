'use client';

import { Clock } from 'lucide-react';
import { GlassCard, PageHeader, StatusBadge } from '@/components/sales-v2/ui';

/**
 * Read-only display today. The org-level business hours + SLA target are
 * configured at the database level (and on Organization seed). A future
 * commit will add inline editing here once we expose the corresponding
 * backend endpoint.
 */
export default function WhatsAppHoursAdminPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp · Settings"
        title="Working hours & SLA"
        description="The routing engine uses these settings to decide which agents can be assigned and when conversations queue for the next business day."
      />
      <GlassCard variant="default" padded="lg">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          <SettingTile
            label="Timezone"
            value="Asia/Karachi (UTC+5)"
            hint="All clock math uses this zone."
          />
          <SettingTile
            label="Working hours"
            value="09:00 — 18:00"
            hint="Inclusive open, exclusive close."
          />
          <SettingTile
            label="Working days"
            value="Mon – Sat"
            hint="Friday off can be added; talk to engineering."
          />
          <SettingTile
            label="First-response SLA"
            value="60 seconds"
            hint="From inbound message to first agent reply."
          />
        </div>
        <div
          className="sos-banner sos-banner--info"
          style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <Clock size={14} />
          <span>
            Editing these settings inline is on the roadmap. They live on the
            <code style={{ margin: '0 4px' }}>core.organizations</code>
            row and can be updated via Prisma Studio or the upcoming
            <code style={{ margin: '0 4px' }}>PATCH /whatsapp/settings</code>
            endpoint.
          </span>
        </div>
      </GlassCard>
    </div>
  );
}

function SettingTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div className="sos-eyebrow">{label}</div>
      <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)', marginTop: 6 }}>
        {value}
      </div>
      <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)', marginTop: 4 }}>
        {hint}
      </div>
    </div>
  );
}
