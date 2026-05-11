'use client';

import type { ReactNode } from 'react';

interface ActionBarProps {
  left?: ReactNode;
  right?: ReactNode;
  hint?: ReactNode;
  sticky?: boolean;
}

/**
 * ActionBar — sticky glass action footer for save / cancel / send-to-finance flows.
 */
export function ActionBar({ left, right, hint, sticky = true }: ActionBarProps) {
  return (
    <div
      className="sos-actionbar"
      style={
        sticky
          ? undefined
          : { position: 'static', marginTop: '24px' }
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
        {left}
        {hint ? (
          <span style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)' }}>{hint}</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        {right}
      </div>
    </div>
  );
}
