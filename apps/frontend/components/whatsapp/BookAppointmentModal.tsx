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
/**
 * Optional bot-captured intent that pre-fills this modal. Sent in by the
 * Finance / Sales chat panel when sales clicks "Book now" on the AI
 * appointment-request banner. We use it to:
 *   - Map modality → appointmentType + a sensible default location/link
 *   - Drop the customer's raw words into the notes so sales has context
 *   - Carry the requestId through so the create call auto-flips the
 *     AppointmentRequest row to CONFIRMED + links the new appointment
 */
export interface AppointmentPrefill {
  appointmentRequestId: string;
  preferredDay: string | null;
  preferredTime: string | null;
  modality: string | null; // CALL | VIDEO | IN_PERSON | UNKNOWN
  rawText: string;
}

export function BookAppointmentModal(props: {
  open: boolean;
  onClose: () => void;
  leadId: string | null;
  clientId: string | null;
  defaultAssigneeId: string | null;
  prefill?: AppointmentPrefill | null;
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

    // Defaults — overridden below if a bot-captured AppointmentPrefill came in.
    setAppointmentType(modalityToType(props.prefill?.modality));
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setDate(prefillDate(props.prefill?.preferredDay) ?? tomorrow.toISOString().slice(0, 10));
    setTime(prefillTime(props.prefill?.preferredTime));
    setDuration(30);
    setLocation('');
    setMeetingLink('');
    setNotes(
      props.prefill
        ? buildPrefillNote(props.prefill)
        : '',
    );
    setSendWhatsApp(true);
    setSubmitting(false);
    setError(null);
    setConfirmationNote(null);
  }, [props.open, props.prefill]);

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
        // Pass back to the backend so the bot-captured request row is
        // auto-flipped to CONFIRMED + linked to this appointment. Without
        // this the chat-panel banner would keep showing the same request
        // forever (until manually closed via the admin page).
        ...(props.prefill?.appointmentRequestId
          ? { appointmentRequestId: props.prefill.appointmentRequestId }
          : {}),
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

// ─── Bot-prefill helpers ────────────────────────────────────────────────────
// All of these are best-effort: when the bot's parser was ambiguous (e.g.
// "soon" with no day), we fall back to the modal's normal defaults so sales
// can pick. Worst case is sales typing what they would have typed anyway.

/**
 * Bot modality → modal's `appointmentType` enum. The modal only exposes
 * CONSULTATION / DOCUMENT_REVIEW / FOLLOW_UP / VISA_FILING / IN_PERSON, so
 * CALL and VIDEO both map to CONSULTATION (the location/meetingLink fields
 * + the notes tell sales which format the customer wanted).
 */
function modalityToType(modality: string | null | undefined): string {
  switch (modality) {
    case 'IN_PERSON': return 'IN_PERSON';
    case 'CALL':
    case 'VIDEO':
    default:          return 'CONSULTATION';
  }
}

/**
 * "Monday" / "tomorrow" / "kal" → YYYY-MM-DD (next occurrence). Returns
 * null for vague/unparseable strings — modal then falls back to "tomorrow".
 */
function prefillDate(preferredDay: string | null | undefined): string | null {
  if (!preferredDay) return null;
  const p = preferredDay.trim().toLowerCase();
  const now = new Date();

  if (p === 'today' || p === 'aaj' || p === 'آج') {
    return now.toISOString().slice(0, 10);
  }
  if (p === 'tomorrow' || p === 'kal' || p === 'کل') {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;

  const weekdayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    اتوار: 0, پیر: 1, منگل: 2, بدھ: 3, جمعرات: 4, جمعہ: 5, ہفتہ: 6,
  };
  const targetDow = weekdayMap[p];
  if (targetDow === undefined) return null;
  const currentDow = now.getDay();
  // Days until next occurrence (1..7, never today).
  const delta = ((targetDow - currentDow + 7) % 7) || 7;
  const target = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

/**
 * "morning" / "afternoon" / "evening" / "3pm" / "15:00" → HH:MM. Returns a
 * sensible default per slot when the bot only gave us a vague time.
 */
function prefillTime(preferredTime: string | null | undefined): string {
  if (!preferredTime) return '10:00';
  const p = preferredTime.trim().toLowerCase();

  // Roman + Urdu vague slots
  if (/morning|subha|صبح/.test(p))         return '10:00';
  if (/afternoon|dopahar|دوپہر/.test(p))   return '14:00';
  if (/evening|sham|شام/.test(p))           return '17:00';
  if (/night|raat|رات/.test(p))             return '19:00';

  // Already HH:MM?
  const hhmm = p.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hh = String(Math.min(23, parseInt(hhmm[1], 10))).padStart(2, '0');
    return `${hh}:${hhmm[2]}`;
  }

  // "3pm" / "11 am" / "5 PM" — strip space, parse.
  const ampm = p.replace(/\s+/g, '').match(/^(\d{1,2})(am|pm)$/);
  if (ampm) {
    let hh = parseInt(ampm[1], 10);
    if (ampm[2] === 'pm' && hh < 12) hh += 12;
    if (ampm[2] === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:00`;
  }

  // "3 baje" — bare number, assume PM if 1-7, AM if 8-12.
  const baje = p.match(/^(\d{1,2})\s*(baje|بجے)?$/);
  if (baje) {
    let hh = parseInt(baje[1], 10);
    if (hh >= 1 && hh <= 7) hh += 12; // 1-7 → afternoon/evening in PKT business context
    return `${String(hh).padStart(2, '0')}:00`;
  }

  return '10:00';
}

function buildPrefillNote(p: AppointmentPrefill): string {
  const tags: string[] = [];
  if (p.preferredDay)  tags.push(p.preferredDay);
  if (p.preferredTime) tags.push(p.preferredTime);
  if (p.modality && p.modality !== 'UNKNOWN') tags.push(p.modality);
  const head = tags.length ? `Bot captured: ${tags.join(' · ')}` : 'Bot captured an appointment intent';
  return `${head}\nClient said: "${p.rawText.slice(0, 200)}"`;
}
