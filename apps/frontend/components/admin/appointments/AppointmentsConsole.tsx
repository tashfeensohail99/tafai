'use client';
// Purpose-built admin Appointments console — replaces the generic ResourceManager
// CRUD table. One cohesive, time-aware surface: clickable KPI strip, three views
// (Agenda by day · By salesperson · dense List), real filters (salesperson / type /
// status / date range / search), a proper booking modal, and the office-hours
// cleanup tucked behind a Tools button. Frontend-only — every filter the backend
// already supports (assignedEmployeeId, scheduledFrom/To, status, search).

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Building2,
  CalendarDays,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  User,
  Users,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, buildQuery } from '@/lib/api-client';
import { downloadCsv } from '@/lib/csv-download';
import { useAdminSession } from '@/components/layout/AdminShell';
import { PageHeader, GhostButton, PrimaryButton, EmptyState, MetricCard } from '@/components/sales-v2/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { OfficeHoursCleanupCard } from '@/components/admin/OfficeHoursCleanupCard';
import { AppointmentBookingModal } from './AppointmentBookingModal';
import {
  type AppointmentRecord,
  type SelectOption,
  type TypeKey,
  assigneeName,
  contactOf,
  formatPktTime,
  formatPktWhen,
  groupByDay,
  groupByEmployee,
  isOutsideOfficeHours,
  TYPE_META,
  typeKeyOf,
  typeLabel,
} from './agenda';

type View = 'agenda' | 'salesperson' | 'list';
type Scope = 'all' | 'next24' | 'next7';

const STATUS_FILTER: SelectOption[] = [
  { value: '', label: 'All statuses' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'NO_SHOW', label: 'No show' },
  { value: 'RESCHEDULED', label: 'Rescheduled' },
];

const TYPE_FILTER: SelectOption[] = [
  { value: '', label: 'All types' },
  { value: 'office', label: 'Office Visit' },
  { value: 'call', label: 'Phone Call' },
  { value: 'video', label: 'Google Meet' },
  { value: 'consult', label: 'Consultation' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function AppointmentsConsole() {
  const { user } = useAdminSession();
  const perms = user?.permissions ?? [];
  const canViewAll = perms.includes('appointments.view_all');
  const canViewAssigned = perms.includes('appointments.view_assigned');
  const canCreate = perms.includes('appointments.create');
  const canUpdate = perms.includes('appointments.update');
  const canCancel = perms.includes('appointments.cancel');
  const canExport = perms.includes('reports.export');

  const [records, setRecords] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [leadOptions, setLeadOptions] = useState<SelectOption[]>([]);
  const [clientOptions, setClientOptions] = useState<SelectOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<SelectOption[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<SelectOption[]>([]);

  const [view, setView] = useState<View>('agenda');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeKey | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [outOfHoursOnly, setOutOfHoursOnly] = useState(false);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<AppointmentRecord | null>(null);

  // ── Load filter option lists once (best-effort; filters still work without). ──
  useEffect(() => {
    interface Person { id: string; firstName?: string; lastName?: string; phone?: string }
    interface CaseLite { id: string; caseNumber: string }
    void (async () => {
      try {
        const [leads, clients, cases, employees] = await Promise.all([
          apiFetch<Person[]>('/leads').catch(() => []),
          apiFetch<Person[]>('/clients').catch(() => []),
          apiFetch<CaseLite[]>('/cases').catch(() => []),
          apiFetch<Person[]>('/employees').catch(() => []),
        ]);
        setLeadOptions(
          leads.filter((l) => l.id).map((l) => ({ value: l.id, label: `${l.firstName ?? ''} ${l.lastName ?? ''} (${l.phone ?? '—'})`.trim() })),
        );
        setClientOptions(
          clients.filter((c) => c.id).map((c) => ({ value: c.id, label: `${c.firstName ?? ''} ${c.lastName ?? ''} (${c.phone ?? '—'})`.trim() })),
        );
        setCaseOptions(cases.filter((c) => c.id).map((c) => ({ value: c.id, label: c.caseNumber })));
        setEmployeeOptions(
          employees.filter((e) => e.id).map((e) => ({ value: e.id, label: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Employee' })),
        );
      } catch {
        /* ignore — option lists are non-critical */
      }
    })();
  }, []);

  // ── Load records whenever a server-side filter changes. ──
  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const scheduledFrom = from ? `${from}T00:00:00+05:00` : new Date().toISOString();
        const scheduledTo = to ? `${to}T23:59:59+05:00` : undefined;
        const query = buildQuery({
          status: statusFilter || undefined,
          assignedEmployeeId: employeeFilter || undefined,
          scheduledFrom,
          scheduledTo,
        });
        const data = await apiFetch<AppointmentRecord[]>(`/appointments${query}`, { cache: 'no-store' });
        setRecords(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load appointments.');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshKey, statusFilter, employeeFilter, from, to]);

  // ── KPI counts over the loaded (server-filtered) set. ──
  const kpi = useMemo(() => {
    const now = Date.now();
    const in24 = now + DAY_MS;
    const in7 = now + 7 * DAY_MS;
    let next24 = 0;
    let next7 = 0;
    let unassigned = 0;
    let outside = 0;
    for (const a of records) {
      const t = new Date(a.scheduledAt).getTime();
      if (t <= in24) next24 += 1;
      if (t <= in7) next7 += 1;
      if (!a.assignedEmployeeId) unassigned += 1;
      if (isOutsideOfficeHours(new Date(a.scheduledAt))) outside += 1;
    }
    return { total: records.length, next24, next7, unassigned, outside };
  }, [records]);

  // ── Apply client-side refinements (scope, flags, type, search). ──
  const visible = useMemo(() => {
    const now = Date.now();
    const in24 = now + DAY_MS;
    const in7 = now + 7 * DAY_MS;
    const q = search.trim().toLowerCase();
    return records.filter((a) => {
      const t = new Date(a.scheduledAt).getTime();
      if (scope === 'next24' && t > in24) return false;
      if (scope === 'next7' && t > in7) return false;
      if (unassignedOnly && a.assignedEmployeeId) return false;
      if (outOfHoursOnly && !isOutsideOfficeHours(new Date(a.scheduledAt))) return false;
      if (typeFilter && typeKeyOf(a.appointmentType) !== typeFilter) return false;
      if (q) {
        const c = contactOf(a);
        const hay = `${a.title} ${a.appointmentType} ${a.location ?? ''} ${c.name} ${c.phone ?? ''} ${assigneeName(a) ?? ''} ${a.case?.caseNumber ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, search, scope, unassignedOnly, outOfHoursOnly, typeFilter]);

  const now = useMemo(() => new Date(), [records]);
  const dayGroups = useMemo(() => groupByDay(visible, now), [visible, now]);
  const empGroups = useMemo(() => groupByEmployee(visible), [visible]);

  const filtersActive =
    !!search || !!statusFilter || !!employeeFilter || !!typeFilter || !!from || !!to || scope !== 'all' || unassignedOnly || outOfHoursOnly;

  function clearAll() {
    setSearch('');
    setStatusFilter('');
    setEmployeeFilter('');
    setTypeFilter('');
    setFrom('');
    setTo('');
    setScope('all');
    setUnassignedOnly(false);
    setOutOfHoursOnly(false);
  }

  function openCreate() {
    setModalMode('create');
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(a: AppointmentRecord) {
    setModalMode('edit');
    setEditing(a);
    setModalOpen(true);
  }

  async function cancelAppointment(a: AppointmentRecord) {
    if (!window.confirm(`Cancel "${a.title}"? The contact is not auto-notified.`)) return;
    const reason = window.prompt('Cancellation reason (optional):') ?? undefined;
    try {
      await apiFetch(`/appointments/${a.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellationReason: reason }),
      });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the appointment.');
    }
  }

  async function exportCsv() {
    const scheduledFrom = from ? `${from}T00:00:00+05:00` : new Date().toISOString();
    const scheduledTo = to ? `${to}T23:59:59+05:00` : undefined;
    const query = buildQuery({
      status: statusFilter || undefined,
      assignedEmployeeId: employeeFilter || undefined,
      scheduledFrom,
      scheduledTo,
      search: search || undefined,
    });
    try {
      await downloadCsv(`/appointments/export.csv${query}`, 'appointments.csv');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  }

  if (!canViewAll && !canViewAssigned) {
    return <PermissionDeniedState />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Admin"
        title="Appointments"
        description="Every upcoming meeting — bot-booked, sales follow-ups, and client consultations — in one place."
        actions={
          <>
            <GhostButton size="sm" iconLeft={<RefreshCw size={15} />} onClick={() => setRefreshKey((k) => k + 1)}>
              Refresh
            </GhostButton>
            {canExport ? (
              <GhostButton size="sm" iconLeft={<Download size={15} />} onClick={() => void exportCsv()}>
                Export
              </GhostButton>
            ) : null}
            <GhostButton size="sm" iconLeft={<Wrench size={15} />} onClick={() => setToolsOpen((v) => !v)}>
              Tools
            </GhostButton>
            {canCreate ? (
              <PrimaryButton size="sm" iconLeft={<Plus size={15} />} onClick={openCreate}>
                New appointment
              </PrimaryButton>
            ) : null}
          </>
        }
      />

      {/* KPI strip — design-system MetricCard tiles that double as clickable scopes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KpiTile
          label="Upcoming"
          value={kpi.total}
          hint="All upcoming"
          tone="info"
          Icon={CalendarDays}
          active={scope === 'all' && !unassignedOnly && !outOfHoursOnly}
          onClick={() => {
            setScope('all');
            setUnassignedOnly(false);
            setOutOfHoursOnly(false);
          }}
        />
        <KpiTile
          label="Next 24 hours"
          value={kpi.next24}
          hint="Within a day"
          tone="accent"
          Icon={Clock}
          active={scope === 'next24'}
          onClick={() => setScope((s) => (s === 'next24' ? 'all' : 'next24'))}
        />
        <KpiTile
          label="Next 7 days"
          value={kpi.next7}
          hint="This week"
          tone="info"
          Icon={CalendarDays}
          active={scope === 'next7'}
          onClick={() => setScope((s) => (s === 'next7' ? 'all' : 'next7'))}
        />
        <KpiTile
          label="Unassigned"
          value={kpi.unassigned}
          hint="Need an owner"
          tone={kpi.unassigned > 0 ? 'warning' : 'neutral'}
          Icon={Users}
          active={unassignedOnly}
          onClick={() => setUnassignedOnly((v) => !v)}
        />
        <KpiTile
          label="Out of hours"
          value={kpi.outside}
          hint="Outside 9–6 PKT"
          tone={kpi.outside > 0 ? 'warning' : 'neutral'}
          Icon={Clock}
          active={outOfHoursOnly}
          onClick={() => setOutOfHoursOnly((v) => !v)}
        />
      </div>

      {/* Tools — office-hours cleanup, collapsed by default */}
      {toolsOpen ? (
        <div className="sos-glass sos-glass--soft" style={{ padding: 16, borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <strong style={{ fontSize: 14, color: 'var(--sos-text-primary)' }}>Tools</strong>
            <GhostButton size="sm" iconLeft={<X size={14} />} onClick={() => setToolsOpen(false)}>
              Hide
            </GhostButton>
          </div>
          <OfficeHoursCleanupCard />
        </div>
      ) : null}

      {/* Controls — view switch + filters */}
      <div className="sos-glass sos-glass--panel" style={{ padding: 16, borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <Segmented
            value={view}
            onChange={(v) => setView(v as View)}
            options={[
              { value: 'agenda', label: 'Agenda', Icon: CalendarDays },
              { value: 'salesperson', label: 'By salesperson', Icon: Users },
              { value: 'list', label: 'List', Icon: MapPin },
            ]}
          />
          <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
            Showing <strong style={{ color: 'var(--sos-text-secondary)' }}>{visible.length}</strong> of {records.length}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
          <LabeledSelect label="Salesperson" value={employeeFilter} onChange={setEmployeeFilter} options={[{ value: '', label: 'All salespeople' }, ...employeeOptions]} />
          <LabeledSelect label="Type" value={typeFilter} onChange={(v) => setTypeFilter(v as TypeKey | '')} options={TYPE_FILTER} />
          <LabeledSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER} />
          <LabeledInput label="From" type="date" value={from} onChange={setFrom} />
          <LabeledInput label="To" type="date" value={to} onChange={setTo} />
          <LabeledInput label="Search" type="text" value={search} onChange={setSearch} placeholder="Name, phone, title…" />
        </div>

        {/* Active scope/flag chips */}
        {filtersActive ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            {scope === 'next24' ? <Chip label="Next 24 hours" onClear={() => setScope('all')} /> : null}
            {scope === 'next7' ? <Chip label="Next 7 days" onClear={() => setScope('all')} /> : null}
            {unassignedOnly ? <Chip label="Unassigned only" onClear={() => setUnassignedOnly(false)} /> : null}
            {outOfHoursOnly ? <Chip label="Out of hours" onClear={() => setOutOfHoursOnly(false)} /> : null}
            <GhostButton size="sm" onClick={clearAll}>
              Clear all
            </GhostButton>
          </div>
        ) : null}
      </div>

      {/* Main content */}
      {loading ? (
        <LoadingState message="Loading appointments…" />
      ) : error ? (
        <ErrorState message="Unable to load appointments" details={error} onRetry={() => setRefreshKey((k) => k + 1)} />
      ) : visible.length === 0 ? (
        <EmptyState
          Icon={CalendarDays}
          title="No appointments"
          description={filtersActive ? 'No appointments match the current filters.' : 'Nothing upcoming. Book one to get started.'}
          action={canCreate ? <PrimaryButton size="sm" iconLeft={<Plus size={15} />} onClick={openCreate}>New appointment</PrimaryButton> : undefined}
        />
      ) : view === 'agenda' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {dayGroups.map((g) => (
            // Each day sits on its own navy glass panel so the rows read on a
            // solid surface (matching the employees table) rather than letting
            // the page's cyan backdrop glow show through translucent rows.
            <div key={g.key} className="sos-glass sos-glass--panel" style={{ padding: 16, borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: g.relative ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-primary)' }}>{g.heading}</h3>
                <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{g.items.length} appointment{g.items.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map((a) => (
                  <AppointmentRow key={a.id} a={a} showAssignee onEdit={canUpdate ? openEdit : undefined} onCancel={canCancel ? cancelAppointment : undefined} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : view === 'salesperson' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {empGroups.map((g) => (
            <div
              key={g.id ?? 'unassigned'}
              className="sos-glass sos-glass--panel"
              style={{ padding: 14, borderRadius: 12, ...(g.id === null ? { borderLeft: '3px solid var(--sos-status-warning)' } : {}) }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {g.id === null ? <Users size={16} color="var(--sos-status-warning)" /> : <User size={16} color="var(--sos-brand-primary-strong)" />}
                  <strong style={{ fontSize: 14, color: g.id === null ? 'var(--sos-status-warning)' : 'var(--sos-text-primary)' }}>{g.name}</strong>
                </div>
                <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{g.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map((a) => (
                  <AppointmentRow key={a.id} a={a} dense onEdit={canUpdate ? openEdit : undefined} onCancel={canCancel ? cancelAppointment : undefined} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ListView rows={visible} onEdit={canUpdate ? openEdit : undefined} onCancel={canCancel ? cancelAppointment : undefined} />
      )}

      <AppointmentBookingModal
        open={modalOpen}
        mode={modalMode}
        record={editing}
        leadOptions={leadOptions}
        clientOptions={clientOptions}
        caseOptions={caseOptions}
        employeeOptions={employeeOptions}
        onClose={() => setModalOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  hint,
  tone,
  active,
  onClick,
  Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: 'accent' | 'warm' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  active?: boolean;
  onClick: () => void;
  Icon: typeof CalendarDays;
}) {
  // Wrap the design-system MetricCard so the KPI strip matches the rest of the
  // admin (employees, etc.) exactly; the active scope shows as a subtle ring.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        borderRadius: 'var(--sos-radius-panel, 16px)',
        boxShadow: active ? '0 0 0 2px var(--sos-brand-primary)' : 'none',
        transition: 'box-shadow 140ms ease',
      }}
    >
      <MetricCard label={label} value={value} hint={hint} tone={tone} Icon={Icon} />
    </button>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; Icon: typeof CalendarDays }[] }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              background: active ? 'var(--sos-brand-primary-soft)' : 'transparent',
              color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
              border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'transparent'}`,
              transition: 'all 140ms ease',
            }}
          >
            <o.Icon size={14} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: SelectOption[] }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="sos-label">{label}</span>
      <select className="sos-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledInput({ label, value, onChange, type, placeholder }: { label: string; value: string; onChange: (v: string) => void; type: string; placeholder?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="sos-label">{label}</span>
      <input className="sos-input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 6px 3px 10px',
        borderRadius: 999,
        fontSize: 12,
        background: 'var(--sos-brand-primary-soft)',
        color: 'var(--sos-brand-primary-strong)',
        border: '1px solid var(--sos-brand-primary-border)',
      }}
    >
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
        <X size={13} />
      </button>
    </span>
  );
}

function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  const k = typeKeyOf(type);
  const color = TYPE_META[k].color;
  if (k === 'office') return <Building2 size={size} color={color} />;
  if (k === 'call') return <Phone size={size} color={color} />;
  if (k === 'video') return <Video size={size} color={color} />;
  if (k === 'consult') return <User size={size} color={color} />;
  return <CalendarDays size={size} color={color} />;
}

function AppointmentRow({
  a,
  showAssignee,
  dense,
  onEdit,
  onCancel,
}: {
  a: AppointmentRecord;
  showAssignee?: boolean;
  dense?: boolean;
  onEdit?: (a: AppointmentRecord) => void;
  onCancel?: (a: AppointmentRecord) => void;
}) {
  const c = contactOf(a);
  const outside = isOutsideOfficeHours(new Date(a.scheduledAt));
  const assignee = assigneeName(a);

  // Neutral card by default — color is reserved for meaning (the type icon and
  // the amber out-of-hours flag), matching the muted admin aesthetic.
  const cell: CSSProperties = {
    display: 'flex',
    gap: 12,
    padding: dense ? '8px 10px' : '12px 14px',
    borderRadius: 10,
    background: 'var(--sos-surface-2)',
    border: '1px solid var(--sos-border-subtle)',
    alignItems: 'flex-start',
    ...(outside ? { borderLeft: '3px solid var(--sos-status-warning)' } : {}),
  };

  return (
    <div style={cell}>
      {/* Time block */}
      <div style={{ width: 78, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--sos-text-primary)' }}>{formatPktTime(a.scheduledAt)}</div>
        <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{a.durationMinutes} min</div>
        {!dense ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11, color: 'var(--sos-text-muted)' }}>
            <TypeIcon type={a.appointmentType} size={12} />
            {typeLabel(a.appointmentType)}
          </div>
        ) : null}
      </div>

      {/* Middle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {dense ? <TypeIcon type={a.appointmentType} size={13} /> : null}
          <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--sos-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
          {outside ? <span style={{ fontSize: 10.5, color: 'var(--sos-status-warning)', border: '1px solid var(--sos-status-warning)', borderRadius: 6, padding: '0 5px', flexShrink: 0 }}>outside 9–6</span> : null}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', marginTop: 2 }}>
          {c.name || '—'}
          {c.kind ? <span style={{ color: 'var(--sos-text-muted)' }}> · {c.kind}</span> : null}
          {c.phone ? <span style={{ color: 'var(--sos-text-muted)' }}> · {c.phone}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
          {a.case?.caseNumber ? <span>📁 {a.case.caseNumber}</span> : null}
          {a.meetingLink ? (
            <a href={a.meetingLink} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--sos-brand-primary-strong)' }}>
              <ExternalLink size={11} /> Meeting link
            </a>
          ) : a.location ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <MapPin size={11} /> {a.location}
            </span>
          ) : null}
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        {showAssignee ? (
          assignee ? (
            <span style={{ fontSize: 11.5, color: 'var(--sos-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <User size={12} /> {assignee}
            </span>
          ) : (
            <span style={{ fontSize: 11.5, color: 'var(--sos-status-warning)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <User size={12} /> Unassigned
            </span>
          )
        ) : null}
        <StatusBadge type="appointment" status={a.status} />
        {onEdit || onCancel ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {onEdit ? (
              <button type="button" onClick={() => onEdit(a)} className="sos-btn sos-btn--ghost sos-btn--sm">
                Edit
              </button>
            ) : null}
            {onCancel && a.status !== 'CANCELLED' && a.status !== 'COMPLETED' ? (
              <button type="button" onClick={() => onCancel(a)} className="sos-btn sos-btn--sm" style={{ color: 'var(--sos-status-danger)', borderColor: 'var(--sos-status-danger)' }}>
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ListView({ rows, onEdit, onCancel }: { rows: AppointmentRecord[]; onEdit?: (a: AppointmentRecord) => void; onCancel?: (a: AppointmentRecord) => void }) {
  const th: CSSProperties = {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'var(--sos-text-muted)',
    background: 'var(--sos-surface-1)',
    borderBottom: '1px solid var(--sos-divider)',
    whiteSpace: 'nowrap',
  };
  const td: CSSProperties = { padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-secondary)', verticalAlign: 'middle' };

  return (
    <div className="sos-glass sos-glass--panel" style={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}>
      <div className="overflow-x-auto sos-scroll">
        <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>When (PKT)</th>
              <th style={th}>Type</th>
              <th style={th}>Title</th>
              <th style={th}>Contact</th>
              <th style={th}>Assigned to</th>
              <th style={th}>Status</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((a, idx) => {
              const c = contactOf(a);
              const assignee = assigneeName(a);
              return (
                <tr
                  key={a.id}
                  style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--sos-divider)', transition: 'background 140ms' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatPktWhen(a.scheduledAt)}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <TypeIcon type={a.appointmentType} />
                      {typeLabel(a.appointmentType)}
                    </span>
                  </td>
                  <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{a.title}</td>
                  <td style={td}>
                    {c.name || '—'}
                    {c.phone ? <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{c.phone}</div> : null}
                  </td>
                  <td style={td}>{assignee ?? <span style={{ color: 'var(--sos-status-warning)' }}>Unassigned</span>}</td>
                  <td style={td}>
                    <StatusBadge type="appointment" status={a.status} />
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {onEdit ? (
                      <button type="button" onClick={() => onEdit(a)} className="sos-btn sos-btn--ghost sos-btn--sm">
                        Edit
                      </button>
                    ) : null}
                    {onCancel && a.status !== 'CANCELLED' && a.status !== 'COMPLETED' ? (
                      <button type="button" onClick={() => onCancel(a)} className="sos-btn sos-btn--sm" style={{ marginLeft: 6, color: 'var(--sos-status-danger)', borderColor: 'var(--sos-status-danger)' }}>
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
