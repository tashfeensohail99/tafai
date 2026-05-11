'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2 } from 'lucide-react';

interface TimelineStepProps {
  Icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  done?: boolean;
}

/** TimelineStep — entry in an activity timeline. */
export function TimelineStep({
  Icon = CheckCircle2,
  title,
  meta,
  description,
  done,
}: TimelineStepProps) {
  return (
    <div className={`sos-timeline-item${done ? ' sos-timeline-item--done' : ''}`}>
      <span className="sos-timeline-item__bullet" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Icon size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {title}
          </span>
          {meta ? (
            <span className="sos-text-faint" style={{ fontSize: '11.5px', letterSpacing: '0.04em' }}>
              {meta}
            </span>
          ) : null}
        </div>
        {description ? (
          <div className="sos-text-muted" style={{ fontSize: '12.5px', lineHeight: 1.55 }}>
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface TimelineProps {
  children: ReactNode;
}

export function Timeline({ children }: TimelineProps) {
  return <div className="sos-timeline">{children}</div>;
}
