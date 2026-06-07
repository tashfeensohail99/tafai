'use client';

import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

export type MetricTone = 'accent' | 'warm' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: string;
  tone?: MetricTone;
  Icon?: LucideIcon;
  footer?: ReactNode;
  /** When provided, the whole card becomes a keyboard-accessible button. */
  onClick?: () => void;
  /** Highlights the card (ring) — use to show it's the active filter. */
  active?: boolean;
}

const toneStyles: Record<
  MetricTone,
  { iconBg: string; iconBorder: string; iconColor: string; chipBg: string; chipColor: string; glow: string }
> = {
  accent: {
    iconBg: 'var(--sos-brand-primary-soft)',
    iconBorder: 'var(--sos-brand-primary-border)',
    iconColor: 'var(--sos-brand-primary-strong)',
    chipBg: 'var(--sos-brand-primary-soft)',
    chipColor: 'var(--sos-brand-primary-strong)',
    glow: 'var(--sos-glow-primary)',
  },
  warm: {
    iconBg: 'var(--sos-brand-accent-soft)',
    iconBorder: 'var(--sos-brand-accent-border)',
    iconColor: 'var(--sos-brand-accent)',
    chipBg: 'var(--sos-brand-accent-soft)',
    chipColor: 'var(--sos-brand-accent)',
    glow: 'var(--sos-glow-warm)',
  },
  success: {
    iconBg: 'var(--sos-status-success-soft)',
    iconBorder: 'var(--sos-status-success-border)',
    iconColor: 'var(--sos-status-success)',
    chipBg: 'var(--sos-status-success-soft)',
    chipColor: 'var(--sos-status-success)',
    glow: 'var(--sos-status-success-soft)',
  },
  warning: {
    iconBg: 'var(--sos-status-warning-soft)',
    iconBorder: 'var(--sos-status-warning-border)',
    iconColor: 'var(--sos-status-warning)',
    chipBg: 'var(--sos-status-warning-soft)',
    chipColor: 'var(--sos-status-warning)',
    glow: 'var(--sos-status-warning-soft)',
  },
  danger: {
    iconBg: 'var(--sos-status-danger-soft)',
    iconBorder: 'var(--sos-status-danger-border)',
    iconColor: 'var(--sos-status-danger)',
    chipBg: 'var(--sos-status-danger-soft)',
    chipColor: 'var(--sos-status-danger)',
    glow: 'var(--sos-status-danger-soft)',
  },
  info: {
    iconBg: 'var(--sos-status-info-soft)',
    iconBorder: 'var(--sos-status-info-border)',
    iconColor: 'var(--sos-status-info)',
    chipBg: 'var(--sos-status-info-soft)',
    chipColor: 'var(--sos-status-info)',
    glow: 'var(--sos-status-info-soft)',
  },
  neutral: {
    iconBg: 'var(--sos-status-neutral-soft)',
    iconBorder: 'var(--sos-border-subtle)',
    iconColor: 'var(--sos-text-secondary)',
    chipBg: 'var(--sos-surface-3)',
    chipColor: 'var(--sos-text-secondary)',
    glow: 'var(--sos-status-neutral-soft)',
  },
};

/**
 * MetricCard — KPI tile rendered inside a glass surface.
 */
export function MetricCard({
  label,
  value,
  hint,
  delta,
  tone = 'accent',
  Icon,
  footer,
  onClick,
  active = false,
}: MetricCardProps) {
  const t = toneStyles[tone];
  const interactive = typeof onClick === 'function';

  return (
    <div
      className="sos-metric"
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': active,
            onClick,
            onKeyDown: (e: ReactKeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            },
          }
        : {})}
      style={{
        ...(interactive ? { cursor: 'pointer' } : {}),
        outline: active ? `2px solid ${t.iconColor}` : undefined,
        outlineOffset: active ? 2 : undefined,
        transition: 'outline-color 140ms, transform 140ms',
      }}
    >
      <span aria-hidden className="sos-metric__glow" style={{ background: t.glow }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        {Icon ? (
          <div
            className="sos-metric__icon"
            style={{
              background: t.iconBg,
              border: `1px solid ${t.iconBorder}`,
              color: t.iconColor,
            }}
          >
            <Icon size={20} />
          </div>
        ) : <span />}

        {delta ? (
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--sos-radius-pill)',
              background: t.chipBg,
              color: t.chipColor,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              border: `1px solid ${t.iconBorder}`,
            }}
          >
            {delta}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="sos-metric__value">{value}</div>
        <div className="sos-metric__label">{label}</div>
        {hint ? <div className="sos-metric__hint">{hint}</div> : null}
      </div>

      {footer ? (
        <div
          style={{
            marginTop: '4px',
            paddingTop: '12px',
            borderTop: '1px solid var(--sos-border-subtle)',
            fontSize: '12px',
            color: 'var(--sos-text-muted)',
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
