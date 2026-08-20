import React, { type CSSProperties, type ReactNode } from 'react';

/** Two-letter initials from a name. */
export function initials(first: string, last: string): string {
  const a = (first || '').trim()[0] ?? '';
  const b = (last || '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

/** Deterministic avatar gradient from a name (stable per person). */
export function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${h} 62% 52%), hsl(${h2} 62% 44%))`;
}

/** Shared table header/cell styles (the app's `.sos-table` class is a no-op, so
 *  padding is applied inline like the polished admin tables do). */
export const th: CSSProperties = {
  padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--sos-text-muted)',
  whiteSpace: 'nowrap', borderBottom: '1px solid var(--sos-divider)',
};
export const td: CSSProperties = {
  padding: '13px 16px', fontSize: 13.5, color: 'var(--sos-text-primary)', verticalAlign: 'middle',
};

const TONES: Record<string, { bg: string; fg: string; bd: string }> = {
  success: { bg: 'var(--sos-status-success-soft)', fg: 'var(--sos-status-success)', bd: 'var(--sos-status-success-border)' },
  warning: { bg: 'var(--sos-status-warning-soft)', fg: 'var(--sos-status-warning)', bd: 'var(--sos-status-warning-border)' },
  danger: { bg: 'var(--sos-status-danger-soft)', fg: 'var(--sos-status-danger)', bd: 'var(--sos-status-danger-border)' },
  neutral: { bg: 'var(--sos-status-neutral-soft)', fg: 'var(--sos-text-secondary)', bd: 'var(--sos-border-subtle)' },
};

export function StatusPill({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.fg }} />
      {children}
    </span>
  );
}
