'use client';

import type { ReactNode } from 'react';

interface DetailPageShellProps {
  header: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
  actionBar?: ReactNode;
}

/**
 * DetailPageShell — premium two-column layout for full detail pages
 * (lead profile, follow-up detail, payment handover).
 */
export function DetailPageShell({ header, main, aside, actionBar }: DetailPageShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {header}
      <div
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: aside ? 'minmax(0, 1.6fr) minmax(280px, 1fr)' : 'minmax(0, 1fr)',
        }}
        className="sos-detail-grid"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>{main}</div>
        {aside ? (
          <aside style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>{aside}</aside>
        ) : null}
      </div>
      {actionBar}
    </div>
  );
}
