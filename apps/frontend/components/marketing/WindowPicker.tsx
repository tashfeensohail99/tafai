'use client';

/**
 * Small segmented control for the "trailing N days" filter that every
 * Marketing dashboard page needs. State is owned by the page (URL not
 * involved yet — Phase 1D scope).
 */
const OPTIONS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function WindowPicker({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Time window"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        borderRadius: 'var(--sos-radius-md, 10px)',
        background: 'var(--sos-surface-subtle, rgba(0,0,0,0.04))',
        border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
      }}
    >
      {OPTIONS.map((o) => {
        const active = o.days === value;
        return (
          <button
            key={o.days}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.days)}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--sos-radius-sm, 7px)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: active ? 'var(--sos-brand-primary-strong, #2563eb)' : 'var(--sos-text-secondary, #4b5563)',
              background: active ? 'var(--sos-surface-primary, #ffffff)' : 'transparent',
              boxShadow: active ? 'var(--sos-shadow-xs, 0 1px 2px rgba(0,0,0,0.06))' : 'none',
              transition: 'background 120ms ease, color 120ms ease',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
