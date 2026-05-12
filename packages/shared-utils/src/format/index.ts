/**
 * @tashfeen/shared-utils — format/index.ts
 *
 * Date, number, name, and file formatting utilities.
 * All date functions accept an ISO string or Date object.
 *
 * No runtime dependencies — uses only Intl (built into Node >=12 & all browsers).
 */

// ─── Date formatting ──────────────────────────────────────────────────────────

const PK_TIMEZONE = 'Asia/Karachi';

/**
 * Format an ISO date string for display.
 * @example fmtDate('2026-05-13T10:00:00Z') → 'May 13, 2026'
 */
export function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: PK_TIMEZONE,
  }).format(new Date(date));
}

/**
 * Format an ISO date-time string with time.
 * @example fmtDateTime('2026-05-13T10:00:00Z') → 'May 13, 2026, 3:00 PM'
 */
export function fmtDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PK_TIMEZONE,
  }).format(new Date(date));
}

/**
 * Format an ISO date-time to time only.
 * @example fmtTime('2026-05-13T10:00:00Z') → '3:00 PM'
 */
export function fmtTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PK_TIMEZONE,
  }).format(new Date(date));
}

/**
 * Deterministic relative time label for mock/seed data timestamps.
 * Returns fixed strings based on difference in days — safe for SSR.
 *
 * @example fmtRelative('2026-05-12T10:00:00Z', new Date('2026-05-13T10:00:00Z')) → '1 day ago'
 */
export function fmtRelative(
  date: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  if (diffDay < 365) {
    const months = Math.floor(diffDay / 30);
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(diffDay / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Live relative time — only use client-side to avoid SSR hydration mismatch.
 */
export function fmtRelativeToNow(date: string | Date): string {
  return fmtRelative(date, new Date());
}

// ─── Name formatting ──────────────────────────────────────────────────────────

/**
 * Combine first/last name into a full name, trimmed.
 */
export function fmtFullName(
  firstName?: string | null,
  lastName?: string | null,
): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim() || '—';
}

/**
 * Initials from first and last name (up to 2 characters).
 * @example fmtInitials('John', 'Doe') → 'JD'
 */
export function fmtInitials(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const first = (firstName ?? '').trim()[0] ?? '';
  const last = (lastName ?? '').trim()[0] ?? '';
  return (first + last).toUpperCase() || '?';
}

// ─── Number / currency formatting ─────────────────────────────────────────────

/**
 * Format a number as currency.
 * @example fmtCurrency(1500, 'PKR') → 'PKR 1,500'
 */
export function fmtCurrency(
  amount: number | null | undefined,
  currency = 'PKR',
): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number with thousands separators.
 * @example fmtNumber(1234567) → '1,234,567'
 */
export function fmtNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-PK').format(value);
}

// ─── File size formatting ─────────────────────────────────────────────────────

/**
 * Format bytes to a human-readable size string.
 * @example fmtFileSize(1536000) → '1.5 MB'
 */
export function fmtFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

// ─── Phone formatting ─────────────────────────────────────────────────────────

/**
 * Mask a phone number for display (e.g. for partial privacy).
 * @example maskPhone('+923001234567') → '+92 300 *** 4567'
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  if (phone.length < 8) return phone;
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, phone.length - 7);
  return `${prefix} *** ${last4}`;
}

// ─── String utilities ─────────────────────────────────────────────────────────

/**
 * Convert SCREAMING_SNAKE_CASE enum values to Title Case labels.
 * @example enumToLabel('FOLLOW_UP') → 'Follow Up'
 */
export function enumToLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Truncate a string to a maximum length, appending '…' if cut.
 */
export function truncate(value: string | null | undefined, maxLen = 80): string {
  if (!value) return '';
  return value.length <= maxLen ? value : `${value.slice(0, maxLen - 1)}…`;
}
