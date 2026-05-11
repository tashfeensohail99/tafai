'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

type GlassCardVariant = 'default' | 'strong' | 'soft' | 'panel' | 'hero';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassCardVariant;
  hover?: boolean;
  padded?: boolean | 'sm' | 'md' | 'lg';
  glow?: 'none' | 'accent' | 'warm';
  children?: ReactNode;
}

const padMap: Record<string, string> = {
  sm: '16px',
  md: '20px',
  lg: '28px',
};

/**
 * GlassCard — premium dark glassmorphism surface.
 * Always read tokens via CSS variables; never hardcode.
 */
export function GlassCard({
  variant = 'default',
  hover = false,
  padded = true,
  glow = 'none',
  className = '',
  style,
  children,
  ...rest
}: GlassCardProps) {
  const variantClass =
    variant === 'strong' ? 'sos-glass sos-glass--strong' :
    variant === 'soft' ? 'sos-glass sos-glass--soft' :
    variant === 'panel' ? 'sos-glass sos-glass--panel' :
    variant === 'hero' ? 'sos-glass sos-glass--hero' :
    'sos-glass';

  const hoverClass = hover ? 'sos-glass-hover' : '';

  const padding =
    padded === false ? undefined :
    padded === true ? padMap.md :
    padMap[padded] ?? padMap.md;

  const finalStyle: CSSProperties = {
    ...(padding ? { padding } : {}),
    position: 'relative',
    overflow: 'hidden',
    ...style,
  };

  return (
    <div className={`${variantClass} ${hoverClass} ${className}`} style={finalStyle} {...rest}>
      {glow === 'accent' ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: '-120px',
            right: '-120px',
            width: '280px',
            height: '280px',
            borderRadius: '50%',
            background: 'var(--sos-glow-primary)',
            filter: 'blur(80px)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {glow === 'warm' ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: '-100px',
            left: '-100px',
            width: '260px',
            height: '260px',
            borderRadius: '50%',
            background: 'var(--sos-glow-warm)',
            filter: 'blur(80px)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}
