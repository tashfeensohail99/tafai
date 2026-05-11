'use client';

import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'warm'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'violet'
  | 'cyan'
  | 'pink';

interface StatusBadgeProps {
  tone?: BadgeTone;
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * StatusBadge — premium pill used to render statuses, sources, priorities.
 */
export function StatusBadge({
  tone = 'neutral',
  size = 'md',
  dot = true,
  icon,
  children,
  style,
  className = '',
}: StatusBadgeProps) {
  const toneClass = `sos-badge--${tone}`;
  const sizeClass = size === 'lg' ? 'sos-badge--lg' : '';
  const plainClass = !dot ? 'sos-badge--plain' : '';

  return (
    <span className={`sos-badge ${toneClass} ${sizeClass} ${plainClass} ${className}`} style={style}>
      {!dot && icon ? <span style={{ display: 'inline-flex' }}>{icon}</span> : null}
      {children}
    </span>
  );
}
