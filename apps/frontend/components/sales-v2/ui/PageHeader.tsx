'use client';

import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}

/**
 * PageHeader — premium glass page header used at the top of every screen.
 * Eyebrow, large display title, supporting description and right-side actions.
 */
export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return (
    <header
      className="sos-glass sos-glass--hero"
      style={{
        padding: '28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Decorative glows */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '-120px',
          right: '-100px',
          width: '320px',
          height: '320px',
          borderRadius: '50%',
          background: 'var(--sos-glow-primary)',
          filter: 'blur(90px)',
          pointerEvents: 'none',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '-80px',
          left: '-80px',
          width: '260px',
          height: '260px',
          borderRadius: '50%',
          background: 'var(--sos-glow-warm)',
          filter: 'blur(80px)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: '24px',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ minWidth: 0 }}>
          {eyebrow ? (
            <div className="sos-eyebrow" style={{ marginBottom: '10px' }}>
              {eyebrow}
            </div>
          ) : null}
          <h1
            className="sos-display"
            style={{
              fontSize: 'clamp(1.85rem, 3.6vw, 2.85rem)',
              maxWidth: '24ch',
            }}
          >
            {title}
          </h1>
          {description ? (
            <p
              className="sos-text-secondary"
              style={{
                marginTop: '12px',
                fontSize: '14.5px',
                lineHeight: 1.65,
                maxWidth: '60ch',
              }}
            >
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {actions}
          </div>
        ) : null}
      </div>

      {meta ? <div style={{ position: 'relative' }}>{meta}</div> : null}
    </header>
  );
}
