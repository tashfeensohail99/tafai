'use client';

import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import {
  Field,
  FormInput,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { convertLeadToClient } from '@/lib/whatsapp';
import { Modal } from './Modal';

interface LeadSeed {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  nationality: string | null;
}

/**
 * "Convert to Client" — opened from the WhatsApp chat panel.
 *
 * The actual conversion is owned by the existing Tafsheen endpoint
 * `POST /leads/:id/convert`. That endpoint:
 *   - finds (or creates) a Client by phone/email
 *   - links Lead.convertedClientId = newClient.id, status = CONVERTED
 *   - records timeline + audit
 *
 * On our side we additionally collect the client-profile fields (passport,
 * DOB, address) that the standalone Client form normally needs, and PATCH
 * them onto the new Client after conversion. For now the convert endpoint
 * doesn't accept those, so the modal just confirms with optional notes;
 * profile enrichment can happen on the dedicated client page later.
 */
export function ConvertToClientModal(props: {
  open: boolean;
  onClose: () => void;
  lead: LeadSeed | null;
  onConverted: (clientId: string) => void;
}) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the modal opens.
  useEffect(() => {
    if (!props.open) return;
    setNotes('');
    setSubmitting(false);
    setError(null);
  }, [props.open]);

  if (!props.lead) {
    return (
      <Modal open={props.open} onClose={props.onClose} title="Convert to client">
        <p className="sos-text-muted">This lead has already been converted to a client.</p>
      </Modal>
    );
  }

  const lead = props.lead;

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = (await convertLeadToClient(lead.id, notes || undefined)) as {
        client?: { id: string };
        clientId?: string;
      };
      const newClientId = result.client?.id ?? result.clientId ?? '';
      props.onConverted(newClientId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Convert to client"
      footer={
        <>
          <GhostButton onClick={props.onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={onSubmit}
            disabled={submitting}
            iconLeft={<UserPlus size={14} />}
          >
            {submitting ? 'Converting…' : 'Convert'}
          </PrimaryButton>
        </>
      }
    >
      <p className="sos-text-secondary" style={{ fontSize: 'var(--sos-text-sm)' }}>
        A new client record will be created with the lead's profile. The full WhatsApp chat
        history follows the new client.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <Field label="First name">
          <FormInput value={lead.firstName} readOnly />
        </Field>
        <Field label="Last name">
          <FormInput value={lead.lastName} readOnly />
        </Field>
        <Field label="Phone">
          <FormInput value={lead.phone} readOnly />
        </Field>
        <Field label="Email">
          <FormInput value={lead.email ?? '—'} readOnly />
        </Field>
        <Field label="Nationality">
          <FormInput value={lead.nationality ?? '—'} readOnly />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Optional note for the client record">
          <textarea
            className="sos-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want recorded about this conversion…"
            style={{ minHeight: 80 }}
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
