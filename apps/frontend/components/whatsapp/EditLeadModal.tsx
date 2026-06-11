'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Save, UserCog } from 'lucide-react';
import {
  Field,
  FormInput,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { patchLead } from '@/lib/sales-api';
import { SERVICE_TYPES } from '@/lib/service-types';
import { CountrySelect } from '@/components/shared/CountrySelect';
import { Modal } from './Modal';

/**
 * Edit Lead Modal — opens with a lead's current identity fields prefilled
 * and lets a sales agent correct the spelling, swap the phone number, or
 * add an email that came in later through the conversation. Used from
 * two places:
 *   - Lead profile page header ("Edit lead" pill)
 *   - WhatsApp chat panel (QuickActionsBar + SidePanel)
 *
 * Only edits identity fields (firstName, lastName, phone, email,
 * service, targetCountry). Pipeline state (stage, priority, notes) is
 * still owned by the dedicated Overview-tab editor on the profile page,
 * which has the surrounding context (stage progress, next-action chips,
 * SLA badges) to make those choices meaningful.
 */
export interface EditLeadModalLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  service?: string;
  targetCountry?: string;
  /** Agreed total service fee. String to preserve decimal precision. */
  serviceFeeAmount?: string;
  serviceFeeCurrency?: string;
}

const FEE_CURRENCIES = ['CAD', 'USD', 'GBP', 'EUR', 'AED', 'PKR'] as const;

export function EditLeadModal(props: {
  open: boolean;
  onClose: () => void;
  /** Current lead; nothing is rendered while this is null. */
  lead: EditLeadModalLead | null;
  /** Called after a successful save; parent should refetch. */
  onSaved: () => void;
}) {
  const { open, onClose, lead, onSaved } = props;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [service, setService] = useState('');
  const [targetCountry, setTargetCountry] = useState('');
  const [serviceFeeAmount, setServiceFeeAmount] = useState('');
  const [serviceFeeCurrency, setServiceFeeCurrency] = useState<string>('CAD');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-prefill ONLY when the modal opens or a different lead is targeted —
  // never on mere parent re-renders. The chat panel rebuilds the `lead`
  // object on every render (and re-renders on every poll tick / incoming
  // message), so depending on the object itself reset the form mid-typing:
  // reps watched their email text vanish as messages arrived.
  useEffect(() => {
    if (!open || !lead) return;
    setFirstName(lead.firstName ?? '');
    setLastName(lead.lastName ?? '');
    setPhone(lead.phone ?? '');
    setEmail(lead.email ?? '');
    setService(lead.service ?? '');
    setTargetCountry(lead.targetCountry ?? '');
    setServiceFeeAmount(lead.serviceFeeAmount ?? '');
    setServiceFeeCurrency(lead.serviceFeeCurrency ?? 'CAD');
    setError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill is
    // keyed on identity (open + lead.id), not on object reference.
  }, [open, lead?.id]);

  async function handleSave() {
    if (!lead) return;
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setError('First name, last name, and phone are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Only send fields that actually changed so we don't burn an audit
      // log row recording "lastName: Khan → Khan".
      const changes: Parameters<typeof patchLead>[1] = {};
      if (firstName.trim() !== lead.firstName) changes.firstName = firstName.trim();
      if (lastName.trim() !== lead.lastName) changes.lastName = lastName.trim();
      if (phone.trim() !== lead.phone) changes.phone = phone.trim();
      if ((email.trim() || undefined) !== (lead.email || undefined)) {
        changes.email = email.trim();
      }
      if ((service.trim() || undefined) !== (lead.service || undefined)) {
        changes.serviceInterest = service.trim();
      }
      if ((targetCountry.trim() || undefined) !== (lead.targetCountry || undefined)) {
        changes.targetCountry = targetCountry.trim();
      }
      // Service fee — pass as string. Empty string clears the field
      // server-side (patchLead converts "" → null on the body).
      if (serviceFeeAmount.trim() !== (lead.serviceFeeAmount ?? '')) {
        changes.serviceFeeAmount = serviceFeeAmount.trim();
      }
      if (serviceFeeCurrency !== (lead.serviceFeeCurrency ?? 'CAD')) {
        changes.serviceFeeCurrency = serviceFeeCurrency;
      }
      // No-op save still counts as success — close the modal anyway.
      if (Object.keys(changes).length > 0) {
        await patchLead(lead.id, changes);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (submitting ? undefined : onClose())}
      title="Edit lead details"
      width={560}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={submitting}>
            Cancel
          </GhostButton>
          <PrimaryButton
            onClick={() => void handleSave()}
            disabled={submitting}
            iconLeft={
              submitting ? (
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Save size={14} />
              )
            }
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        </>
      }
    >
      <div
        className="sos-text-secondary"
        style={{ fontSize: 'var(--sos-text-sm)', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <UserCog size={14} />
        <span>
          Update the contact details. Pipeline stage and priority are edited from the lead
          profile&apos;s Overview tab.
        </span>
      </div>

      <div
        style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <Field label="First name" required>
          <FormInput
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
          />
        </Field>
        <Field label="Last name" required>
          <FormInput
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
          />
        </Field>
        <Field label="Phone" required hint="E.164 preferred (e.g. +92312…)">
          <FormInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+92 ..."
            inputMode="tel"
          />
        </Field>
        <Field label="Email" hint="Optional — improves auto-routing">
          <FormInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="lead@example.com"
            type="email"
            inputMode="email"
          />
        </Field>
        <Field label="Service of interest" required>
          {/* Native select — same `sos-input` styling as every other field
              in the modal so it picks up the platform's premium look in both
              light/dark themes. Defaults to empty so sales must actively
              pick one of the 9 canonical types (no typed-in typos). The
              first option is a disabled placeholder so the dropdown opens
              showing "Select a service…" until they choose. */}
          <select
            className="sos-input"
            value={
              service && SERVICE_TYPES.some((s) => s.code === service) ? service : ''
            }
            onChange={(e) => setService(e.target.value)}
          >
            <option value="" disabled>
              Select a service…
            </option>
            {SERVICE_TYPES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          {/* Show the legacy free-text value when it doesn't match any code
              so sales knows what was there before and can reclassify. */}
          {service && !SERVICE_TYPES.some((s) => s.code === service) ? (
            <div
              style={{
                marginTop: 8,
                fontSize: 11.5,
                color: 'var(--sos-text-muted)',
              }}
            >
              Legacy value: <strong style={{ color: 'var(--sos-text-secondary)' }}>{service}</strong> — pick a coded type from the dropdown to reclassify.
            </div>
          ) : null}
        </Field>
        <Field label="Target country">
          <CountrySelect
            value={targetCountry}
            onChange={setTargetCountry}
            placeholder="Search all countries…"
          />
        </Field>
      </div>

      {/* Service fee — captured here so Finance has the agreed total
          anchor when the first installment receipt comes through. Without
          this, every handover would create a separate Invoice and the
          lead's running balance can't be computed cleanly. */}
      <div
        style={{
          marginTop: 16,
          padding: '12px 14px',
          borderRadius: 'var(--sos-radius-sm)',
          background: 'var(--sos-surface-1)',
          border: '1px solid var(--sos-border-subtle)',
        }}
      >
        <div className="sos-eyebrow" style={{ marginBottom: 8 }}>
          Agreed service fee
        </div>
        <div className="sos-text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Total amount the client agreed to pay for this service. Anchors a
          single Invoice that every installment payment rolls up against —
          finance sees &ldquo;paid X of Y&rdquo; cleanly. Leave blank if the
          deal isn&apos;t priced yet.
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 120px)',
            gap: 10,
            alignItems: 'flex-end',
          }}
        >
          <Field label="Fee amount">
            <FormInput
              value={serviceFeeAmount}
              onChange={(e) => setServiceFeeAmount(e.target.value)}
              placeholder="e.g. 5000"
              inputMode="decimal"
            />
          </Field>
          <Field label="Currency">
            <select
              className="sos-input"
              value={serviceFeeCurrency}
              onChange={(e) => setServiceFeeCurrency(e.target.value)}
            >
              {FEE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {error ? (
        <div
          className="sos-banner sos-banner--danger"
          style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}
