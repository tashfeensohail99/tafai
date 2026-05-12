'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { createAppointment } from '@/lib/whatsapp';
import { Modal } from './Modal';

/**
 * "Book Appointment" — quick-book a consultation linked to the current
 * lead/client. Sends the create-appointment request to the existing
 * Tafsheen `POST /appointments` endpoint.
 *
 * Times are submitted as ISO. Date+time inputs are local PKT — converted
 * with the browser's local TZ.
 */
export function BookAppointmentModal(props: {
  open: boolean;
  onClose: () => void;
  leadId: string | null;
  clientId: string | null;
  defaultAssigneeId: string | null;
  onBooked: () => void;
}) {
  const [title, setTitle] = useState('Initial consultation');
  const [appointmentType, setAppointmentType] = useState('CONSULTATION');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setTitle('Initial consultation');
    setAppointmentType('CONSULTATION');
    // Default date = tomorrow.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setDate(tomorrow.toISOString().slice(0, 10));
    setTime('10:00');
    setDuration(30);
    setLocation('');
    setMeetingLink('');
    setNotes('');
    setSubmitting(false);
    setError(null);
  }, [props.open]);

  const onSubmit = async () => {
    if (!date || !time) {
      setError('Date and time are required');
      return;
    }
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    setSubmitting(true);
    setError(null);
    try {
      await createAppointment({
        ...(props.leadId ? { leadId: props.leadId } : {}),
        ...(props.clientId ? { clientId: props.clientId } : {}),
        ...(props.defaultAssigneeId ? { assignedEmployeeId: props.defaultAssigneeId } : {}),
        title,
        appointmentType,
        scheduledAt,
        durationMinutes: duration,
        ...(location ? { location } : {}),
        ...(meetingLink ? { meetingLink } : {}),
        ...(notes ? { notes } : {}),
      });
      props.onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book appointment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Book appointment"
      footer={
        <>
          <GhostButton onClick={props.onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={onSubmit}
            disabled={submitting}
            iconLeft={<CalendarClock size={14} />}
          >
            {submitting ? 'Booking…' : 'Book'}
          </PrimaryButton>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <Field label="Title" required>
          <FormInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <FormSelect
          label="Type"
          value={appointmentType}
          onChange={(e) => setAppointmentType(e.target.value)}
          options={[
            { value: 'CONSULTATION', label: 'Consultation' },
            { value: 'DOCUMENT_REVIEW', label: 'Document review' },
            { value: 'FOLLOW_UP', label: 'Follow-up' },
            { value: 'VISA_FILING', label: 'Visa filing' },
            { value: 'IN_PERSON', label: 'In-person meeting' },
          ]}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Date" required>
            <input
              type="date"
              className="sos-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Time" required>
            <input
              type="time"
              className="sos-input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Duration (min)">
            <FormInput
              type="number"
              value={String(duration)}
              onChange={(e) => setDuration(Number(e.target.value) || 30)}
              min={5}
              step={5}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Location" hint="In-person address (optional)">
            <FormInput
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office, Karachi"
            />
          </Field>
          <Field label="Meeting link" hint="For remote (optional)">
            <FormInput
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              placeholder="https://meet.google.com/…"
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            className="sos-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ minHeight: 70 }}
            placeholder="Anything to prepare for this appointment…"
          />
        </Field>
      </div>

      {error && (
        <div className="sos-banner sos-banner--danger" style={{ marginTop: 12 }}>
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}
