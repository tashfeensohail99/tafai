'use client';

/**
 * Read-only disposition pill for inbox rows / lead cards. Matches the tone
 * palette used by DispositionControl so the two visually agree — a JUNK
 * chip on a row is the same red as the JUNK option in the picker.
 *
 * When `disposition` is null and `emptyLabel` is provided, renders the
 * "+ Tag" affordance (mirroring the mobile inbox). When null and no
 * emptyLabel, renders nothing.
 */

import { Plus, Tag } from 'lucide-react';
import { DISPOSITION_LABEL, type LeadDisposition } from '@/lib/whatsapp';

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

export function DispositionChip({
  disposition,
  emptyLabel,
  onClick,
  compact = true,
}: {
  disposition: LeadDisposition | null | undefined;
  /** Rendered when disposition is null. Omit to render nothing on empty. */
  emptyLabel?: string;
  /** If set, chip becomes a button; stops propagation so the row's click doesn't fire. */
  onClick?: () => void;
  /** Compact variant for inbox rows (default). */
  compact?: boolean;
}) {
  if (!disposition && !emptyLabel) return null;

  const tone = disposition ? TONE[disposition] : 'neutral';
  const color = TONE_COLOR[tone];
  const isEmpty = !disposition;

  const commonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: compact ? 3 : 5,
    padding: compact ? '1px 6px' : '3px 8px',
    borderRadius: 999,
    fontSize: compact ? 10.5 : 12,
    fontWeight: 700,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    lineHeight: compact ? '15px' : '18px',
    background: isEmpty ? 'transparent' : color,
    color: isEmpty ? color : '#fff',
    border: isEmpty ? `1px dashed ${color}` : `1px solid ${color}`,
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
  };

  const label = disposition ? DISPOSITION_LABEL[disposition] : (emptyLabel ?? '');
  const icon = isEmpty
    ? <Plus size={compact ? 10 : 12} />
    : <Tag size={compact ? 10 : 12} />;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={disposition ? `Disposition: ${label}` : 'Set disposition'}
        style={{ ...commonStyle, border: commonStyle.border }}
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <span style={commonStyle} title={`Disposition: ${label}`}>
      {icon}
      {label}
    </span>
  );
}
