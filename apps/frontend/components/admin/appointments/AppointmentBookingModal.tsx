'use client';
// Create / edit an appointment with real controls — a native datetime picker
// (entered as PKT wall-clock), a type select that auto-fills the office address
// or reveals a meeting-link field, a duration select, and an inline office-hours
// warning. Replaces the old generic ResourceManager field-dump that made the
// admin hand-type an ISO timestamp.

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  Field,
  FormInput,
  FormSelect,
  FormTextarea,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import {
  BOOKABLE_TYPES,
  OFFICE_ADDRESS,
  type AppointmentRecord,
  type SelectOption,
  inputValueOutsideOfficeHours,
  isoToPktInputValue,
  pktInputValueToIso,
  typeKeyOf,
  typeLabel,
} from './agenda';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'NO_SHOW', label: 'No show' },
  { value: 'RESCHEDULED', label: 'Rescheduled' },
];

const DURATION_OPTIONS: SelectOption[] = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
];

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  record?: AppointmentRecord | null;
  leadOptions: SelectOption[];
  clientOptions: SelectOption[];
  caseOptions: SelectOption[];
  employeeOptions: SelectOption[];
  onClose: () => void;
  onSaved: () => void;
}

type ContactKind = 'lead' | 'client';

export function AppointmentBookingModal({
  open,
  mode,
  record,
  leadOptions,
  clientOptions,
  caseOptions,
  employeeOptions,
  onClose,
  onSaved,
}: Props) {
  const [contactKind, setContactKind] = useState<ContactKind>('lead');
  const [leadId, setLeadId] = useState('');
  const [clientId, setClientId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [appointmentType, setAppointmentType] = useState<string>('Office Visit');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('SCHEDULED');
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form whenever the modal opens (or the target record changes).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    if (mode === 'edit' && record) {
      setContactKind(record.clientId ? 'client' : 'lead');
      setLeadId(record.leadId ?? '');
      setClientId(record.clientId ?? '');
      setCaseId(record.caseId ?? '');
      setAssignedEmployeeId(record.assignedEmployeeId ?? '');
      setTitle(record.title ?? '');
      setAppointmentType(record.appointmentType ?? 'Consultation');
      setScheduledLocal(isoToPktInputValue(record.scheduledAt));
      setDurationMinutes(String(record.durationMinutes ?? 30));
      setLocation(record.location ?? '');
      setMeetingLink(record.meetingLink ?? '');
      setNotes(record.notes ?? '');
      setStatus(record.status ?? 'SCHEDULED');
      setSendWhatsApp(false);
    } else {
      setContactKind('lead');
      setLeadId('');
      setClientId('');
      setCaseId('');
      setAssignedEmployeeId('');
      setTitle('');
      setAppointmentType('Office Visit');
      setScheduledLocal('');
      setDurationMinutes('30');
      setLocation('');
      setMeetingLink('');
      setNotes('');
      setStatus('SCHEDULED');
      setSendWhatsApp(false);
    }
  }, [open, mode, record]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const typeKey = typeKeyOf(appointmentType);
  const outsideHours = useMemo(() => inputValueOutsideOfficeHours(scheduledLocal), [scheduledLocal]);

  if (!open) return null;

  function handleTypeChange(next: string) {
    setAppointmentType(next);
    // Help the admin: when no title yet, default it to the type label; for an
    // office visit pre-fill the office address if the location is blank.
    setTitle((t) => (t.trim() ? t : typeLabel(next)));
    if (typeKeyOf(next) === 'office') {
      setLocation((l) => (l.trim() ? l : OFFICE_ADDRESS));
    }
  }

  async function handleSubmit() {
    setError(null);

    if (mode === 'create') {
      if (contactKind === 'lead' && !leadId) return setError('Select the lead this appointment is for.');
      if (contactKind === 'client' && !clientId) return setError('Select the client this appointment is for.');
    }
    if (!title.trim()) return setError('Add a title.');
    if (!scheduledLocal) return setError('Pick a date and time.');
    const iso = pktInputValueToIso(scheduledLocal);
    if (!iso) return setError('That date and time is invalid.');

    setSubmitting(true);
    try {
      if (mode === 'edit' && record) {
        await apiFetch(`/appointments/${record.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            assignedEmployeeId: assignedEmployeeId || undefined,
            title: title.trim(),
            appointmentType,
            scheduledAt: iso,
            durationMinutes: Number(durationMinutes || 30),
            location: location.trim() || undefined,
            meetingLink: meetingLink.trim() || undefined,
            notes: notes.trim() || undefined,
            status,
          }),
        });
      } else {
        await apiFetch('/appointments', {
          method: 'POST',
          body: JSON.stringify({
            leadId: contactKind === 'lead' ? leadId || undefined : undefined,
            clientId: contactKind === 'client' ? clientId || undefined : undefined,
            caseId: caseId || undefined,
            assignedEmployeeId: assignedEmployeeId || undefined,
            title: title.trim(),
            appointmentType,
            scheduledAt: iso,
            durationMinutes: Number(durationMinutes || 30),
            location: location.trim() || undefined,
            meetingLink: meetingLink.trim() || undefined,
            notes: notes.trim() || undefined,
            sendWhatsAppConfirmation: sendWhatsApp || undefined,
          }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the appointment.');
    } finally {
      setSubmitting(false);
    }
  }

  const contactLabel =
    mode === 'edit' && record
      ? record.client
        ? `${record.client.firstName ?? ''} ${record.client.lastName ?? ''}`.trim() || 'Client'
        : record.lead
          ? `${record.lead.firstName ?? ''} ${record.lead.lastName ?? ''}`.trim() || 'Lead'
          : '—'
      : '';

  const typeOptions: SelectOption[] = BOOKABLE_TYPES.map((t) => ({ value: t, label: t }));
  // In edit mode the stored type might be something custom — keep it selectable.
  if (mode === 'edit' && appointmentType && !typeOptions.some((o) => o.value === appointmentType)) {
    typeOptions.unshift({ value: appointmentType, label: appointmentType });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'edit' ? 'Edit appointment' : 'New appointment'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--sos-bg-overlay)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '24px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sos-glass sos-glass--panel"
        style={{
          width: '100%',
          maxWidth: 720,
          borderRadius: 'var(--sos-radius-panel, 16px)',
          padding: 24,
          margin: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            {mode === 'edit' ? 'Edit appointment' : 'New appointment'}
          </h3>
          <GhostButton size="sm" type="button" onClick={onClose}>
            Close
          </GhostButton>
        </div>
        <p style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginBottom: 18 }}>
          Times are in Pakistan time (PKT). Office hours are 9 AM–6 PM.
        </p>

        {/* Contact */}
        {mode === 'create' ? (
          <div style={{ marginBottom: 14 }}>
            <Field label="Appointment for" required>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['lead', 'client'] as ContactKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setContactKind(k)}
                    className={`sos-btn sos-btn--sm ${contactKind === k ? 'sos-btn--primary' : 'sos-btn--ghost'}`}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {contactKind === 'lead' ? (
                <FormSelect
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                  placeholder="Select a lead"
                  options={leadOptions}
                />
              ) : (
                <FormSelect
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Select a client"
                  options={clientOptions}
                />
              )}
            </Field>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <Field label="Appointment for">
              <div style={{ fontSize: 14, color: 'var(--sos-text-primary)', padding: '8px 0' }}>
                {contactLabel}{' '}
                <span style={{ color: 'var(--sos-text-muted)', fontSize: 12 }}>
                  (contact can't be changed after booking)
                </span>
              </div>
            </Field>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FormSelect
            label="Type"
            required
            value={appointmentType}
            onChange={(e) => handleTypeChange(e.target.value)}
            options={typeOptions}
          />
          <FormSelect
            label="Assigned to"
            value={assignedEmployeeId}
            onChange={(e) => setAssignedEmployeeId(e.target.value)}
            placeholder="Unassigned"
            options={employeeOptions}
          />

          <div>
            <FormInput
              label="Date & time (PKT)"
              required
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
            />
            {outsideHours ? (
              <div className="sos-help" style={{ color: 'var(--sos-status-warning)', marginTop: -6 }}>
                ⚠ Outside office hours (9 AM–6 PM PKT)
              </div>
            ) : null}
          </div>
          <FormSelect
            label="Duration"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            options={DURATION_OPTIONS}
          />

          <FormInput
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Visa consultation"
          />
          <FormSelect
            label="Case (optional)"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="No case"
            options={caseOptions}
          />

          {typeKey === 'video' ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <FormInput
                label="Meeting link"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://meet.google.com/…"
              />
            </div>
          ) : (
            <div style={{ gridColumn: '1 / -1' }}>
              <FormInput
                label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={typeKey === 'office' ? OFFICE_ADDRESS : 'Optional'}
              />
            </div>
          )}

          {mode === 'edit' ? (
            <FormSelect
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={STATUS_OPTIONS}
            />
          ) : null}

          <div style={{ gridColumn: '1 / -1' }}>
            <FormTextarea
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything the team should know before the meeting"
            />
          </div>
        </div>

        {mode === 'create' ? (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 14,
              fontSize: 13,
              color: 'var(--sos-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} />
            Send a WhatsApp confirmation to the contact (if their 24h window is open)
          </label>
        ) : null}

        {error ? (
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13, marginTop: 14 }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <GhostButton type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </GhostButton>
          <PrimaryButton type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Book appointment'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
