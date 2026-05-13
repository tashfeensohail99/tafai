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
      className="sos-glass sos-glass--hero sos-page-header"
      style={{
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

      <div className="sos-page-header__row">
        <div className="sos-page-header__content">
          {eyebrow ? (
            <div className="sos-eyebrow" style={{ marginBottom: '10px' }}>
              {eyebrow}
            </div>
          ) : null}
          <h1 className="sos-display sos-page-header__title">
            {title}
          </h1>
          {description ? (
            <p className="sos-text-secondary sos-page-header__description">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="sos-page-header__actions">
            {actions}
          </div>
        ) : null}
      </div>

      {meta ? <div style={{ position: 'relative' }}>{meta}</div> : null}
    </header>
  );
}
