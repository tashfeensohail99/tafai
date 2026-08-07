'use client';

import type { ReactNode } from 'react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';

/**
 * Phase 1A placeholder for a Marketing section not yet built. The portal shell +
 * navigation land now (so the marketing user can see the intended structure);
 * each section is filled in a later phase.
 */
export function ComingSoon({
  title,
  eyebrow,
  description,
  bullets,
  icon,
}: {
  title: string;
  eyebrow?: string;
  description: string;
  bullets?: string[];
  icon?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader eyebrow={eyebrow ?? 'Marketing'} title={title} description={description} />
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          {icon ? <div style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }}>{icon}</div> : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--sos-brand-primary-strong)',
                  background: 'var(--sos-brand-primary-soft)',
                  border: '1px solid var(--sos-brand-primary-border)',
                  borderRadius: 'var(--sos-radius-pill)',
                  padding: '3px 10px',
                }}
              >
                Coming soon
              </span>
            </div>
            <p style={{ margin: '0 0 12px', color: 'var(--sos-text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
              This section is scaffolded in Phase 1A (portal + access). The data and controls land in a
              later phase — the navigation is here now so the module structure is visible end to end.
            </p>
            {bullets && bullets.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--sos-text-secondary)', fontSize: 13.5, lineHeight: 1.7 }}>
                {bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
