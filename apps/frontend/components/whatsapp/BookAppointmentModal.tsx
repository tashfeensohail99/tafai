'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, MessageCircle } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { createAppointment, type CreateAppointmentResult } from '@/lib/whatsapp';
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
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationNote, setConfirmationNote] = useState<string | null>(null);

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
    setSendWhatsApp(true);
    setSubmitting(false);
    setError(null);
    setConfirmationNote(null);
  }, [props.open]);

  const onSubmit = async () => {
    if (!date || !time) {
      setError('Date and time are required');
      return;
    }
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    setSubmitting(true);
    setError(null);
    setConfirmationNote(null);
    try {
      const result: CreateAppointmentResult = await createAppointment({
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
        sendWhatsAppConfirmation: sendWhatsApp,
      });

      if (sendWhatsApp && result.whatsappConfirmation && !result.whatsappConfirmation.sent) {
        // Keep modal open with an informational note so the agent knows the
        // appointment was booked but no WhatsApp message went out.
        setConfirmationNote(describeSkipReason(result.whatsappConfirmation.reason));
        return;
      }
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
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 'var(--sos-radius-sm)',
            background: 'var(--sos-surface-1)',
            border: '1px solid var(--sos-border-subtle)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={sendWhatsApp}
            onChange={(e) => setSendWhatsApp(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 'var(--sos-text-sm)',
                fontWeight: 600,
              }}
            >
              <MessageCircle size={13} /> Send WhatsApp confirmation now
            </span>
            <span className="sos-text-muted" style={{ fontSize: 'var(--sos-text-xs)' }}>
              Free-form message — only sends if the 24-hour conversation window is still open.
            </span>
          </div>
        </label>
      </div>

      {confirmationNote && (
        <div className="sos-banner sos-banner--warning" style={{ marginTop: 12 }}>
          <span>{confirmationNote}</span>
        </div>
      )}
      {error && (
        <div className="sos-banner sos-banner--danger" style={{ marginTop: 12 }}>
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}

function describeSkipReason(reason: 'no_thread' | 'window_expired' | 'no_phone' | 'no_channel'): string {
  switch (reason) {
    case 'window_expired':
      return 'Appointment booked. The 24-hour WhatsApp window has expired, so the confirmation was not sent — send a template message from the chat instead.';
    case 'no_thread':
      return 'Appointment booked. No active WhatsApp conversation found for this contact, so no confirmation was sent.';
    case 'no_phone':
      return 'Appointment booked. No phone number on file, so no WhatsApp confirmation was sent.';
    case 'no_channel':
      return 'Appointment booked, but the WhatsApp channel is unavailable. Contact admin.';
  }
}
