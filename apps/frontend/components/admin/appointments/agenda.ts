// Pure helpers for the admin Appointments console — PKT-aware date math,
// grouping, and type metadata. No React / no side effects so the logic is
// trivially testable and shared between the console, the agenda rows and the
// booking modal.
//
// The business runs on Pakistan Standard Time (UTC+5, no DST). The browser may
// be in any timezone (the Canada office, a traveller's laptop), so every time
// we render or bucket a date we pin it to Asia/Karachi rather than the viewer's
// local zone. Office hours are 9 AM–6 PM PKT, matching the backend
// (OFFICE_OPEN_HOUR=9 / OFFICE_CLOSE_HOUR=18 in appointments.service.ts).

export const PKT_TZ = 'Asia/Karachi';
export const OFFICE_OPEN_HOUR = 9;
export const OFFICE_CLOSE_HOUR = 18;

/** Canonical Islamabad office address (kept in sync with the WhatsApp bot). */
export const OFFICE_ADDRESS =
  'Office No. 3029B, 3rd Floor, World Trade Centre, Giga Mall, Sector F, DHA Phase 2, Islamabad';

export interface AppointmentRecord {
  id: string;
  leadId?: string | null;
  clientId?: string | null;
  caseId?: string | null;
  assignedEmployeeId?: string | null;
  title: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes: number;
  location?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
  status: string;
  lead?: { id?: string; firstName?: string | null; lastName?: string | null; phone?: string | null; status?: string | null } | null;
  client?: { id?: string; firstName?: string | null; lastName?: string | null; phone?: string | null; status?: string | null } | null;
  assignedEmployee?: { id?: string; firstName?: string | null; lastName?: string | null } | null;
  case?: { id?: string; caseNumber?: string | null; status?: string | null } | null;
}

export interface SelectOption {
  label: string;
  value: string;
}

// ─── PKT date helpers ────────────────────────────────────────────────────────

/** Stable `YYYY-MM-DD` calendar-day key in PKT (en-CA yields ISO order). */
export function pktDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PKT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Hour-of-day (0–23) in PKT. */
export function pktHour(d: Date): number {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: PKT_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return parseInt(s, 10) || 0;
}

/** True when a time falls outside 9 AM–6 PM PKT. */
export function isOutsideOfficeHours(d: Date): boolean {
  const h = pktHour(d);
  return h < OFFICE_OPEN_HOUR || h >= OFFICE_CLOSE_HOUR;
}

/** "2:30 PM" in PKT. */
export function formatPktTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PKT_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** "Mon, Jun 1, 2:30 PM" in PKT — used in the dense List view. */
export function formatPktWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PKT_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** "Mon, Jun 1" label for a `YYYY-MM-DD` day key. */
export function formatDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dt);
}

/** The day key that follows the given `YYYY-MM-DD` key. */
export function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** ISO for the start (00:00 PKT) of the PKT day containing `now`. */
export function startOfTodayPktIso(now: Date): string {
  return `${pktDayKey(now)}T00:00:00+05:00`;
}

// ─── datetime-local ↔ ISO (PKT wall-clock) ───────────────────────────────────

/** ISO → "YYYY-MM-DDTHH:mm" PKT wall-clock for a <input type="datetime-local">. */
export function isoToPktInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PKT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** "YYYY-MM-DDTHH:mm" entered as PKT wall-clock → ISO (UTC) for the API. */
export function pktInputValueToIso(local: string): string {
  if (!local) return '';
  const d = new Date(`${local}:00+05:00`);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** True when a datetime-local value (PKT wall-clock) is outside office hours. */
export function inputValueOutsideOfficeHours(local: string): boolean {
  if (!local) return false;
  const iso = pktInputValueToIso(local);
  return iso ? isOutsideOfficeHours(new Date(iso)) : false;
}

// ─── Contact / assignee helpers ──────────────────────────────────────────────

export function contactOf(a: AppointmentRecord): { kind: 'Client' | 'Lead' | null; name: string; phone: string | null } {
  if (a.client) {
    return {
      kind: 'Client',
      name: `${a.client.firstName ?? ''} ${a.client.lastName ?? ''}`.trim(),
      phone: a.client.phone ?? null,
    };
  }
  if (a.lead) {
    return {
      kind: 'Lead',
      name: `${a.lead.firstName ?? ''} ${a.lead.lastName ?? ''}`.trim(),
      phone: a.lead.phone ?? null,
    };
  }
  return { kind: null, name: '', phone: null };
}

export function assigneeName(a: AppointmentRecord): string | null {
  const e = a.assignedEmployee;
  if (!e) return null;
  const n = `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();
  return n || null;
}

// ─── Appointment type metadata ───────────────────────────────────────────────

export type TypeKey = 'office' | 'call' | 'video' | 'consult' | 'other';

export function typeKeyOf(type: string): TypeKey {
  const t = (type || '').toLowerCase();
  if (/office|visit|in.?person/.test(t)) return 'office';
  if (/phone|call/.test(t)) return 'call';
  if (/meet|video|zoom|google/.test(t)) return 'video';
  if (/consult/.test(t)) return 'consult';
  return 'other';
}

export const TYPE_META: Record<TypeKey, { label: string; color: string }> = {
  office: { label: 'Office Visit', color: 'var(--sos-status-success)' },
  call: { label: 'Phone Call', color: 'var(--sos-status-info)' },
  video: { label: 'Google Meet', color: 'var(--sos-brand-primary-strong)' },
  consult: { label: 'Consultation', color: 'var(--sos-status-warning)' },
  other: { label: 'Appointment', color: 'var(--sos-text-muted)' },
};

/** Canonical label for a known type, else the raw stored string. */
export function typeLabel(type: string): string {
  const k = typeKeyOf(type);
  return k === 'other' ? type || 'Appointment' : TYPE_META[k].label;
}

/** The four bookable types offered in the New/Edit form. */
export const BOOKABLE_TYPES = ['Office Visit', 'Phone Call', 'Google Meet', 'Consultation'] as const;

// ─── Grouping ────────────────────────────────────────────────────────────────

export interface DayGroup {
  key: string;
  heading: string;
  relative: 'Today' | 'Tomorrow' | null;
  items: AppointmentRecord[];
}

export function groupByDay(items: AppointmentRecord[], now: Date): DayGroup[] {
  const today = pktDayKey(now);
  const tomorrow = nextDayKey(today);
  const map = new Map<string, AppointmentRecord[]>();
  for (const a of items) {
    const k = pktDayKey(new Date(a.scheduledAt));
    const bucket = map.get(k);
    if (bucket) bucket.push(a);
    else map.set(k, [a]);
  }
  return [...map.keys()]
    .sort()
    .map((key) => {
      const relative = key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : null;
      const label = formatDayLabel(key);
      return {
        key,
        relative,
        heading: relative ? `${relative} · ${label}` : label,
        items: (map.get(key) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
      };
    });
}

export interface EmployeeGroup {
  id: string | null;
  name: string;
  items: AppointmentRecord[];
}

const UNASSIGNED_KEY = '__unassigned__';

export function groupByEmployee(items: AppointmentRecord[]): EmployeeGroup[] {
  const map = new Map<string, { name: string; items: AppointmentRecord[] }>();
  for (const a of items) {
    const id = a.assignedEmployeeId ?? UNASSIGNED_KEY;
    const name = id === UNASSIGNED_KEY ? 'Unassigned' : assigneeName(a) ?? 'Unknown';
    const entry = map.get(id);
    if (entry) entry.items.push(a);
    else map.set(id, { name, items: [a] });
  }
  return [...map.entries()]
    .map(([id, v]) => ({
      id: id === UNASSIGNED_KEY ? null : id,
      name: v.name,
      items: v.items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    }))
    .sort((a, b) => {
      // Unassigned floats to the top (it needs action), then by load desc.
      if (a.id === null) return -1;
      if (b.id === null) return 1;
      return b.items.length - a.items.length;
    });
}
