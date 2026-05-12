'use client';

import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { createFollowUp } from '@/lib/whatsapp';
import { Modal } from './Modal';

/**
 * "Add Follow-up" — schedule a callback / task tied to the lead.
 * Wraps the existing Tafsheen `POST /follow-ups` endpoint.
 */
export function AddFollowUpModal(props: {
  open: boolean;
  onClose: () => void;
  leadId: string | null;
  defaultAssigneeId: string | null;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('Follow up on WhatsApp conversation');
  const [description, setDescription] = useState('');
  const [contactMethod, setContactMethod] = useState('whatsapp');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setTitle('Follow up on WhatsApp conversation');
    setDescription('');
    setContactMethod('whatsapp');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setDate(tomorrow.toISOString().slice(0, 10));
    setTime('10:00');
    setPriority('MEDIUM');
    setSubmitting(false);
    setError(null);
  }, [props.open]);

  const onSubmit = async () => {
    if (!props.leadId) {
      setError('Follow-ups must be linked to a lead. Convert this thread to a lead first.');
      return;
    }
    if (!date || !time) {
      setError('Date and time are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createFollowUp({
        leadId: props.leadId,
        ...(props.defaultAssigneeId ? { assignedEmployeeId: props.defaultAssigneeId } : {}),
        title,
        ...(description ? { description } : {}),
        contactMethod,
        dueAt: new Date(`${date}T${time}`).toISOString(),
        priority,
      });
      props.onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create follow-up');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Add follow-up"
      footer={
        <>
          <GhostButton onClick={props.onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={onSubmit}
            disabled={submitting || !props.leadId}
            iconLeft={<Phone size={14} />}
          >
            {submitting ? 'Creating…' : 'Create follow-up'}
          </PrimaryButton>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <Field label="Title" required>
          <FormInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Due date" required>
            <input
              type="date"
              className="sos-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Due time" required>
            <input
              type="time"
              className="sos-input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormSelect
            label="Contact method"
            value={contactMethod}
            onChange={(e) => setContactMethod(e.target.value)}
            options={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'phone', label: 'Phone call' },
              { value: 'email', label: 'Email' },
              { value: 'in_person', label: 'In person' },
            ]}
          />
          <FormSelect
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')}
            options={[
              { value: 'LOW', label: 'Low' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'HIGH', label: 'High' },
              { value: 'URGENT', label: 'Urgent' },
            ]}
          />
        </div>
        <Field label="Description">
          <textarea
            className="sos-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ minHeight: 70 }}
            placeholder="What does the agent need to do at this follow-up…"
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
