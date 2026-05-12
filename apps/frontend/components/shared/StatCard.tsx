import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <div
      className="rounded-[24px] border p-5 shadow-sm"
      style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--sos-text-muted)' }}>
          {label}
        </span>
        {icon ? (
          <span
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{ backgroundColor: 'var(--sos-bg-app)', color: 'var(--sos-brand-primary)' }}
          >
            {icon}
          </span>
        ) : null}
      </div>

      <div className="mt-5 text-4xl font-semibold tracking-tight" style={{ color: 'var(--sos-text-primary)' }}>
        {value}
      </div>

      {hint ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--sos-text-muted)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}