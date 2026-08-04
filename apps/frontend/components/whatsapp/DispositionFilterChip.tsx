'use client';

/**
 * Inbox filter chip for disposition — web equivalent of the mobile inbox's
 * "Disposition" funnel chip (inbox_screen.dart). Shows "Disposition" when no
 * filter is set, or the picked disposition (toned) with a clear button when
 * one is active. Clicking opens a dropdown: "Any disposition" + all 10 values.
 *
 * Controlled: parent owns the `value` and reloads the thread list on change.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Filter as FilterIcon, X } from 'lucide-react';
import {
  DISPOSITION_LABEL,
  LEAD_DISPOSITIONS,
  type LeadDisposition,
} from '@/lib/whatsapp';

const TONE: Record<LeadDisposition, 'good' | 'warn' | 'bad' | 'neutral'> = {
  CONVERTED_TO_DEAL: 'good',
  QUALIFIED: 'good',
  FOLLOW_UP: 'warn',
  CONTACT_LATER: 'warn',
  REQUESTED_DISCOUNT: 'neutral',
  PRICE_CONCERN: 'neutral',
  NO_RESPONSE: 'neutral',
  NOT_ELIGIBLE: 'bad',
  JUNK: 'bad',
  DEAD: 'bad',
};

const TONE_COLOR: Record<'good' | 'warn' | 'bad' | 'neutral', string> = {
  good: 'var(--sos-status-success)',
  warn: 'var(--sos-status-warning-strong, #b7791f)',
  bad: 'var(--sos-status-danger-strong)',
  neutral: 'var(--sos-text-secondary)',
};

export function DispositionFilterChip({
  value,
  onChange,
}: {
  value: LeadDisposition | null;
  onChange: (d: LeadDisposition | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = value != null;
  const color = active ? TONE_COLOR[TONE[value]] : 'var(--sos-text-secondary)';

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Filter chats by sales disposition"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 11px',
          borderRadius: 16,
          border: `1px solid ${active ? color : 'var(--sos-border-subtle)'}`,
          background: active ? color : 'transparent',
          color: active ? '#fff' : 'var(--sos-text-secondary)',
          fontSize: 12.5,
          fontWeight: active ? 600 : 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <FilterIcon size={12} />
        {active ? DISPOSITION_LABEL[value] : 'Disposition'}
        {active ? (
          <span
            role="button"
            aria-label="Clear disposition filter"
            onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}
            style={{ display: 'inline-flex', marginLeft: 1, opacity: 0.9 }}
          >
            <X size={13} />
          </span>
        ) : (
          <ChevronDown size={13} style={{ opacity: 0.7 }} />
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="sos-glass sos-glass--strong"
          style={{
            position: 'absolute',
            left: 0,
            top: 'calc(100% + 6px)',
            minWidth: 210,
            maxHeight: 320,
            overflowY: 'auto',
            borderRadius: 12,
            zIndex: 80,
            padding: 6,
          }}
        >
          <MenuItem
            label="Any disposition"
            selected={value == null}
            dotColor={null}
            onClick={() => { onChange(null); setOpen(false); }}
          />
          <div style={{ height: 1, background: 'var(--sos-border-subtle)', margin: '4px 0' }} />
          {LEAD_DISPOSITIONS.map((d) => (
            <MenuItem
              key={d}
              label={DISPOSITION_LABEL[d]}
              selected={value === d}
              dotColor={TONE_COLOR[TONE[d]]}
              onClick={() => { onChange(d); setOpen(false); }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  selected,
  dotColor,
  onClick,
}: {
  label: string;
  selected: boolean;
  dotColor: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        background: selected ? 'var(--sos-surface-2)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: selected ? 700 : 500,
        color: 'var(--sos-text-primary)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--sos-surface-2)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selected ? 'var(--sos-surface-2)' : 'transparent'; }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          flexShrink: 0,
          background: dotColor ?? 'transparent',
          border: dotColor ? 'none' : '1px solid var(--sos-border-subtle)',
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {selected ? <Check size={14} style={{ color: 'var(--sos-text-muted)' }} /> : null}
    </button>
  );
}
