'use client';

/**
 * Delivery-status chip for Meta ads / ad sets / campaigns. Meta's
 * `effective_status` has ~10 possible values (ACTIVE, PAUSED, DELETED,
 * ARCHIVED, DISAPPROVED, PENDING_REVIEW, WITH_ISSUES, CAMPAIGN_PAUSED,
 * ADSET_PAUSED, IN_PROCESS). We collapse them into three tones so the
 * eye grabs the important state (green healthy / gray idle / red broken).
 */
type Tone = 'green' | 'gray' | 'red' | 'amber';

const TONE_STYLE: Record<Tone, { bg: string; color: string; border: string }> = {
  green: { bg: 'rgba(22,163,74,0.10)', color: '#15803d', border: 'rgba(22,163,74,0.30)' },
  gray:  { bg: 'rgba(107,114,128,0.10)', color: '#4b5563', border: 'rgba(107,114,128,0.30)' },
  red:   { bg: 'rgba(220,38,38,0.10)', color: '#b91c1c', border: 'rgba(220,38,38,0.30)' },
  amber: { bg: 'rgba(217,119,6,0.10)', color: '#b45309', border: 'rgba(217,119,6,0.30)' },
};

function toneOf(status: string | null | undefined): Tone {
  if (!status) return 'gray';
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'green';
  if (s === 'DISAPPROVED' || s === 'DELETED') return 'red';
  if (s.includes('PENDING') || s.includes('IN_PROCESS') || s.includes('ISSUES')) return 'amber';
  return 'gray';
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  const label = (status ?? 'UNKNOWN').replace(/_/g, ' ');
  const t = TONE_STYLE[toneOf(status)];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
        padding: '2px 8px',
        borderRadius: 'var(--sos-radius-pill, 999px)',
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
