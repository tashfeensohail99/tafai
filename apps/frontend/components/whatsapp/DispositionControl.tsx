'use client';

import { useState } from 'react';
import { Tag } from 'lucide-react';
import { DISPOSITION_LABEL, type LeadDisposition } from '@/lib/whatsapp';
import { DispositionPickerModal } from './DispositionPickerModal';

// Visual tone per disposition so the chip reads at a glance:
// good = a positive/won outcome, warn = needs follow-up, bad = dead-ends.
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

function toneColors(tone: 'good' | 'warn' | 'bad' | 'neutral', active: boolean) {
  const map = {
    good: 'var(--sos-status-success)',
    warn: 'var(--sos-status-warning-strong, #b7791f)',
    bad: 'var(--sos-status-danger-strong)',
    neutral: 'var(--sos-text-secondary)',
  } as const;
  const c = map[tone];
  return active
    ? { background: c, color: '#fff', border: `1px solid ${c}` }
    : { background: 'transparent', color: c, border: '1px solid var(--sos-border-subtle)' };
}

/**
 * Sales-disposition control for the WhatsApp chat screen: a compact chip
 * showing the current disposition; tapping opens the DispositionPickerModal
 * (extracted so the same picker can be triggered from row menus elsewhere).
 * Separate from pipeline status — this only sets the call-outcome tag.
 */
export function DispositionControl({
  leadId,
  current,
  onChanged,
}: {
  leadId: string;
  current: LeadDisposition | null;
  onChanged?: (d: LeadDisposition) => void;
}) {
  const [open, setOpen] = useState(false);

  const chipTone = current ? TONE[current] : 'neutral';
  const chipStyle = toneColors(chipTone, !!current);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Set the sales disposition for this lead"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          ...chipStyle,
        }}
      >
        <Tag size={13} />
        {current ? DISPOSITION_LABEL[current] : 'Set disposition'}
      </button>

      <DispositionPickerModal
        open={open}
        leadId={leadId}
        current={current}
        onClose={() => setOpen(false)}
        onSaved={onChanged}
      />
    </>
  );
}
