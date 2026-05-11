'use client';

import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

interface RoleBadgeProps {
  role: string;
  icon?: ReactNode;
}

/**
 * RoleBadge — chip showing the active workspace role / persona.
 * Uses brand gradient styling.
 */
export function RoleBadge({ role, icon }: RoleBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 12px',
        borderRadius: 'var(--sos-radius-pill)',
        background: 'var(--sos-brand-gradient)',
        color: 'var(--sos-text-on-accent)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        border: '1px solid var(--sos-surface-tint-on-accent)',
        boxShadow: 'var(--sos-shadow-glow)',
      }}
    >
      {icon ?? <ShieldCheck size={12} />}
      <span>{role}</span>
    </span>
  );
}
