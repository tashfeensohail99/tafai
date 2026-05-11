'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  Icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div
      className="sos-glass sos-glass--soft"
      style={{
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '20px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-brand-primary-soft)',
          color: 'var(--sos-brand-primary-strong)',
          border: '1px solid var(--sos-brand-primary-border)',
        }}
      >
        <Icon size={26} />
      </div>
      <h3 className="sos-title" style={{ fontSize: '17px' }}>
        {title}
      </h3>
      {description ? (
        <p className="sos-text-muted" style={{ fontSize: '13.5px', maxWidth: '40ch' }}>
          {description}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: '8px' }}>{action}</div> : null}
    </div>
  );
}
