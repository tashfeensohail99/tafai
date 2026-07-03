import type { CSSProperties } from 'react';
import type { MetricTone } from '@/components/sales-v2/ui';
import type { VisitStatus, VisitType } from '@/lib/reception-api';

export const TYPE_META: Record<VisitType, { label: string; tone: MetricTone }> = {
  WALK_IN: { label: 'Walk-in', tone: 'info' },
  EXISTING_CLIENT: { label: 'Client', tone: 'accent' },
  PAID_CONSULT: { label: 'Paid consult', tone: 'warning' },
};

export const STATUS_TONE: Record<VisitStatus, MetricTone> = {
  WAITING: 'warning',
  IN_MEETING: 'info',
  DONE: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'neutral',
};

export const STATUS_LABEL: Record<VisitStatus, string> = {
  WAITING: 'Waiting',
  IN_MEETING: 'In meeting',
  DONE: 'Done',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
};

/** Today's date in Pakistan time as YYYY-MM-DD. */
export function todayPkt(): string {
  const p = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
}

/** ISO → "HH:MM" in Pakistan time. */
export function fmtTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** ISO → "3d" / "2h 05m" / "12m" / "just now", elapsed until `nowMs`. */
export function fmtElapsed(iso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(iso).getTime());
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Duration between two ISO timestamps as "1h 05m" / "12m". */
export function fmtDuration(fromIso: string, toIso: string): string {
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** Up to two initials from a name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--sos-text-faint)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  color: 'var(--sos-text-secondary)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  verticalAlign: 'middle',
};

export function avatarStyle(size = 34): CSSProperties {
  return {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    fontSize: size < 32 ? 11 : 12.5,
    fontWeight: 700,
    color: 'var(--sos-brand-primary-strong)',
    background: 'var(--sos-brand-primary-soft)',
    border: '1px solid var(--sos-brand-primary-border)',
  };
}
