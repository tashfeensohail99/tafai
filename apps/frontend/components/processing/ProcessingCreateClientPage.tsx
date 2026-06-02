'use client';

// Processing Manager — manually create a client.
// Second on-ramp into the processing pipeline (no Finance handover). The new
// client lands in the intake queue exactly like a finance-originated case;
// the manager then acknowledges + assigns to seed the document checklist.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { UserPlus, ArrowRight, CheckCircle2, Loader2, Info } from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  FormInput,
  Field,
} from '@/components/sales-v2/ui';
import { CountrySelect } from '@/components/shared/CountrySelect';
import { SERVICE_TYPES } from '@/lib/service-types';
import { createManualClientCase, type ProcessingPriority } from '@/lib/processing';

const PRIORITIES: ProcessingPriority[] = ['LOW', 'NORMAL', 'URGENT', 'CRITICAL'];

export function ProcessingCreateClientPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [targetCountry, setTargetCountry] = useState('');
  const [nationality, setNationality] = useState('');
  const [priority, setPriority] = useState<ProcessingPriority>('NORMAL');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    !!service &&
    targetCountry.trim().length > 0 &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createManualClientCase({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        service,
        targetCountry: targetCountry.trim(),
        ...(nationality.trim() ? { nationality: nationality.trim() } : {}),
        priority,
      });
      setDone({ id: created.id, name: `${firstName.trim()} ${lastName.trim()}` });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Success state ----
  if (done) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <GlassCard variant="strong" padded="lg">
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <CheckCircle2 size={42} style={{ color: 'var(--sos-status-success)', marginBottom: 12 }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              Client created
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--sos-text-muted)', marginTop: 6, lineHeight: 1.55 }}>
              <strong>{done.name}</strong> has been added and a case is now in the{' '}
              <strong>intake queue</strong>. Acknowledge it to assign an associate and
              build the document checklist.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              <PrimaryButton iconLeft={<ArrowRight size={14} />} onClick={() => router.push(`/processing/cases/${done.id}` as Route)}>
                Open case
              </PrimaryButton>
              <SecondaryButton onClick={() => router.push('/processing/intake' as Route)}>
                Go to intake queue
              </SecondaryButton>
              <SecondaryButton
                onClick={() => {
                  setDone(null);
                  setFirstName(''); setLastName(''); setEmail(''); setPhone('');
                  setService(''); setTargetCountry(''); setNationality(''); setPriority('NORMAL');
                }}
              >
                Create another
              </SecondaryButton>
            </div>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ---- Form ----
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserPlus size={13} /> New client
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0 }}>
          Create a client
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--sos-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          Add a client directly into processing — for onboarding existing clients or
          preparing a case. They enter the intake queue just like a finance-sent case.
        </p>
      </div>

      <GlassCard variant="strong" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Muhammad" />
            <FormInput label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ali" />
          </div>

          {/* Contact */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" hint="Optional" />
            <FormInput label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" hint="Optional — add later for WhatsApp" />
          </div>

          {/* Service */}
          <Field label="Service" required>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 4 }}>
              {SERVICE_TYPES.map((s) => {
                const active = service === s.code;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => setService(s.code)}
                    style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)',
                      border: `1.5px solid ${active ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)'}`,
                      background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                      cursor: 'pointer', transition: 'all 150ms',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{s.label}</div>
                    {s.caption ? <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 2 }}>{s.caption}</div> : null}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Country + nationality */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Target country" required>
              <CountrySelect value={targetCountry} onChange={setTargetCountry} placeholder="Destination country…" />
            </Field>
            <FormInput label="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Pakistan" hint="Optional" />
          </div>

          {/* Priority */}
          <Field label="Priority">
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {PRIORITIES.map((p) => {
                const active = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      padding: '7px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                      border: `1.5px solid ${active ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)'}`,
                      background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                      color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
                      cursor: 'pointer', transition: 'all 150ms',
                    }}
                  >
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </Field>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--sos-text-muted)', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
            <Info size={14} style={{ flexShrink: 0 }} />
            The checklist + milestones are built when you acknowledge the case in the intake queue (where you also confirm the program, e.g. C11 / LMIA).
          </div>

          {error ? (
            <div className="sos-banner sos-banner--danger">{error}</div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <SecondaryButton onClick={() => router.push('/processing' as Route)} disabled={submitting}>Cancel</SecondaryButton>
            <PrimaryButton onClick={handleSubmit} disabled={!canSubmit} iconLeft={submitting ? <Loader2 size={14} /> : <UserPlus size={14} />}>
              {submitting ? 'Creating…' : 'Create client'}
            </PrimaryButton>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
