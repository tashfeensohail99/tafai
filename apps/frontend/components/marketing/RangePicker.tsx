'use client';

import { useMemo } from 'react';
import type { MarketingRange } from '@/lib/marketing';

/**
 * Window filter for the Marketing leads pages. Quick trailing-days chips
 * (Today / 7d / 30d / 90d) plus a "Custom" mode that reveals From/To date
 * inputs for an exact range (a single day when From === To). Emits a
 * MarketingRange; the page owns the state and turns it into query params via
 * rangeParams(). Superset of the older WindowPicker (which only did 7/30/90).
 */
const QUICK: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function todayYmd(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

export function RangePicker({
  value,
  onChange,
}: {
  value: MarketingRange;
  onChange: (r: MarketingRange) => void;
}) {
  const today = useMemo(todayYmd, []);
  const isCustom = value.mode === 'custom';
  const from = isCustom ? value.from : today;
  const to = isCustom ? value.to : today;

  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
        {QUICK.map((o) => {
          const active = value.mode === 'days' && value.days === o.days;
          return (
            <Segment
              key={o.days}
              label={o.label}
              active={active}
              onClick={() => onChange({ mode: 'days', days: o.days })}
            />
          );
        })}
        <Segment
          label="Custom"
          active={isCustom}
          onClick={() => onChange({ mode: 'custom', from: today, to: today })}
        />
      </div>

      {isCustom ? (
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <DateInput
            aria-label="From date"
            value={from}
            max={to}
            onChange={(v) => onChange({ mode: 'custom', from: v, to: v > to ? v : to })}
          />
          <span style={{ color: 'var(--sos-text-tertiary, #6b7280)', fontSize: 12 }}>→</span>
          <DateInput
            aria-label="To date"
            value={to}
            min={from}
            max={today}
            onChange={(v) => onChange({ mode: 'custom', from: v < from ? v : from, to: v })}
          />
        </div>
      ) : null}
    </div>
  );
}

function Segment({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
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
      {label}
    </button>
  );
}

function DateInput({
  value,
  min,
  max,
  onChange,
  ...rest
}: {
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
  'aria-label'?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
      style={{
        padding: '5px 8px',
        fontSize: 12,
        borderRadius: 'var(--sos-radius-sm, 7px)',
        border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
        background: 'var(--sos-surface-primary, #ffffff)',
        color: 'var(--sos-text-primary, #111827)',
        colorScheme: 'light',
      }}
      {...rest}
    />
  );
}
