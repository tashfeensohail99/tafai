'use client';
// Sales OS — Create Lead wizard (premium dark glass redesign).

import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Flame,
  Footprints,
  Globe2,
  HandCoins,
  Mail,
  Megaphone,
  MessageSquare,
  Phone,
  PhoneCall,
  Save,
  Snowflake,
  Sparkles,
  StickyNote,
  Thermometer,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEmployeeSession } from '@/components/layout/EmployeeShell';
import { type LeadSource } from '@/components/sales-v2/mockData';
import { POPULAR_COUNTRIES } from '@/lib/countries';
import { CountrySelect } from '@/components/shared/CountrySelect';
import {
  ButtonLink,
  Field,
  FormInput,
  FormTextarea,
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  SuccessButton,
} from '@/components/sales-v2/ui';

type Temp = 'HOT' | 'WARM' | 'COLD';
type StepKey = 'CLIENT' | 'SOURCE' | 'INTEREST' | 'OWNERSHIP' | 'NOTES' | 'REVIEW';

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  source: LeadSource | null;
  service: string;
  country: string;
  temperature: Temp;
  salesPerson: string;
  note: string;
}

const initial: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  source: null,
  service: '',
  country: '',
  temperature: 'WARM',
  salesPerson: '',
  note: '',
};

// Canonical service-type chips. Codes are what we persist to
// Lead.serviceInterest so downstream (Finance, Processing checklists) can
// look up per-service requirements without fuzzy-matching free text.
// Labels are what the agent sees on the chip. Empty by default — sales
// MUST pick one before submitting.
import { SERVICE_TYPES } from '@/lib/service-types';
const SERVICES = SERVICE_TYPES;
// Quick-pick chips for the destinations we see most; the searchable
// CountrySelect below covers every other country (Schengen states, etc.).
const COUNTRIES = POPULAR_COUNTRIES;
function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function initialsFromEmail(email: string): string {
  const name = displayNameFromEmail(email);
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? 'U').toUpperCase();
}

interface SourceOption {
  key: LeadSource;
  label: string;
  caption: string;
  Icon: LucideIcon;
  tone: string;
}
const SOURCE_OPTIONS: SourceOption[] = [
  { key: 'WALK_IN',   label: 'Walk-in',      caption: 'Client visited the office',      Icon: Footprints,    tone: 'var(--sos-status-neutral)' },
  { key: 'FACEBOOK',  label: 'Facebook Ads', caption: 'Lead from Facebook campaign',    Icon: Megaphone,     tone: 'var(--sos-status-info)' },
  { key: 'INSTAGRAM', label: 'Instagram DM', caption: 'Direct message from Instagram',  Icon: Camera,        tone: 'var(--sos-status-pink)' },
  { key: 'WEBSITE',   label: 'Website CRM',  caption: 'Submitted via the website form', Icon: Globe2,        tone: 'var(--sos-status-violet)' },
  { key: 'WHATSAPP',  label: 'WhatsApp',     caption: 'Inquired through WhatsApp',      Icon: MessageSquare, tone: 'var(--sos-status-success)' },
  { key: 'REFERRAL',  label: 'Referral',     caption: 'Referred by an existing client', Icon: HandCoins,     tone: 'var(--sos-brand-accent)' },
  { key: 'PHONE',     label: 'Phone Call',   caption: 'Direct phone inquiry',           Icon: PhoneCall,     tone: 'var(--sos-status-cyan)' },
];

interface TempOption {
  key: Temp;
  label: string;
  hint: string;
  Icon: LucideIcon;
  tone: string;
}
const TEMP_OPTIONS: TempOption[] = [
  { key: 'HOT',  label: 'Hot',  hint: 'Ready to pay this week',          Icon: Flame,       tone: 'var(--sos-status-danger)' },
  { key: 'WARM', label: 'Warm', hint: 'Interested, needs a few touches', Icon: Thermometer, tone: 'var(--sos-brand-accent)' },
  { key: 'COLD', label: 'Cold', hint: 'Just exploring options',          Icon: Snowflake,   tone: 'var(--sos-status-cyan)' },
];

interface StepDef {
  key: StepKey;
  label: string;
  short: string;
  description: string;
  prompt: string;
}
const STEPS: StepDef[] = [
  {
    key: 'CLIENT',
    label: 'Client info',
    short: 'Client',
    description:
      'Capture the client exactly as your team will use them in follow-ups, appointments, and documentation.',
    prompt: "What is the client's full name?",
  },
  {
    key: 'SOURCE',
    label: 'Lead source',
    short: 'Source',
    description: 'Tag the source now so the queue stays filterable later without cleanup.',
    prompt: 'Which channel brought this lead in?',
  },
  {
    key: 'INTEREST',
    label: 'Service & country',
    short: 'Interest',
    description:
      'Record the requested visa or service and the target country before the first consultation.',
    prompt: 'What service and target country are they asking for?',
  },
  {
    key: 'OWNERSHIP',
    label: 'Owner & priority',
    short: 'Owner',
    description: 'Assign the right sales owner and temperature so the next action is obvious.',
    prompt: 'Who should own this lead today?',
  },
  {
    key: 'NOTES',
    label: 'Discussion note',
    short: 'Notes',
    description: 'Capture the exact context your consultant or finance team should see next.',
    prompt: 'What context should the next consultant see?',
  },
  {
    key: 'REVIEW',
    label: 'Review & save',
    short: 'Review',
    description: 'Final check before this lead lands in the working queue.',
    prompt: 'Is everything ready before this lead enters the queue?',
  },
];

/** 10–15 digits (E.164 range), allowing +, spaces, dashes, parentheses. */
function isValidPhone(p: string): boolean {
  const trimmed = p.trim();
  if (!/^[+\d][\d\s()-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function validateStep(step: StepKey, f: FormState): string | null {
  if (step === 'CLIENT') {
    if (!f.firstName.trim()) return 'First name is required';
    if (!f.lastName.trim()) return 'Last name is required';
    if (!f.phone.trim()) return 'Phone number is required';
    if (!isValidPhone(f.phone)) return 'Enter a valid phone number (10–15 digits, e.g. +92 300 1234567)';
    if (f.email.trim() && !isValidEmail(f.email)) return 'Enter a valid email address (e.g. name@example.com)';
  }
  if (step === 'SOURCE' && !f.source) return 'Pick where this lead came from';
  if (step === 'INTEREST') {
    if (!f.service) return 'Select a service';
    if (!f.country) return 'Select a target country';
  }
  if (step === 'OWNERSHIP' && !f.salesPerson) return 'Assign this lead to a sales person';
  return null;
}

type UpdateFn = (key: keyof FormState, value: FormState[keyof FormState]) => void;

export function SalesCreateLeadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useEmployeeSession();
  const ownerName = displayNameFromEmail(user.email);
  const ownerInitials = initialsFromEmail(user.email);

  // Inbox "Convert to Lead" deep-link prefills phone + source so the
  // agent can complete the rest of the wizard without retyping the
  // contact's number. threadId is held so we can link the thread back
  // to the new lead server-side.
  const prefillPhone = searchParams.get('phone') ?? '';
  const prefillSource = searchParams.get('source');
  const whatsAppThreadId = searchParams.get('threadId');
  const validatedSource = useMemo<LeadSource | null>(() => {
    const allowed: LeadSource[] = ['WALK_IN', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'WHATSAPP', 'REFERRAL', 'PHONE'];
    return prefillSource && (allowed as string[]).includes(prefillSource)
      ? (prefillSource as LeadSource)
      : null;
  }, [prefillSource]);

  const [form, setForm] = useState<FormState>(() => ({
    ...initial,
    salesPerson: ownerName,
    phone: prefillPhone,
    source: validatedSource,
  }));
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const totalSteps = STEPS.length;
  const progressPct = Math.round(((stepIdx + 1) / totalSteps) * 100);

  const update: UpdateFn = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  function goNext() {
    const issue = validateStep(step.key, form);
    if (issue) {
      setError(issue);
      return;
    }
    setError(null);
    if (!isLast) setStepIdx((i) => i + 1);
  }
  function goBack() {
    setError(null);
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }
  function jumpTo(idx: number) {
    if (idx <= stepIdx) {
      setError(null);
      setStepIdx(idx);
    }
  }
  function handleSaveDraft() {
    setSavedDraft(true);
    setTimeout(() => setSavedDraft(false), 2400);
  }
  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/leads', {
        method: 'POST',
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          sourceChannel: form.source ?? undefined,
          serviceInterest: form.service || undefined,
          targetCountry: form.country || undefined,
          priority: form.temperature || undefined,
          notes: form.note.trim() || undefined,
          whatsAppThreadId: whatsAppThreadId ?? undefined,
        }),
      });
      // If they came from the inbox via Convert-to-Lead, drop them back
      // into the same chat — now linked to a real Lead. Otherwise go to the
      // leads list to start working the new lead.
      if (whatsAppThreadId) {
        router.push('/sales/inbox' as Route);
      } else {
        router.push('/sales/leads' as Route);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create lead';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Lead intake flow"
        title={<>Create a new lead the team can act on today.</>}
        description={
          <>
            Step {stepIdx + 1} of {totalSteps} · {step.label}. Capture the basics now and the queue
            stays clean — every lead gets a name, a source, an owner, and a clear next move.
          </>
        }
        actions={
          <>
            <ButtonLink
              href={'/sales/leads' as Route}
              variant="ghost"
              iconLeft={<ArrowLeft size={15} />}
            >
              Back to queue
            </ButtonLink>
            {savedDraft ? (
              <StatusBadge tone="success" size="lg">
                <Check size={13} /> Draft saved
              </StatusBadge>
            ) : (
              <SecondaryButton iconLeft={<Save size={15} />} onClick={handleSaveDraft}>
                Save draft
              </SecondaryButton>
            )}
          </>
        }
        meta={
          <ProgressMeta
            stepIdx={stepIdx}
            totalSteps={totalSteps}
            progressPct={progressPct}
            jumpTo={jumpTo}
          />
        }
      />

      <GlassCard variant="strong" padded="lg" glow="accent">
        <PromptHeader stepIdx={stepIdx} step={step} />

        <div style={{ marginTop: '24px' }}>
          <StepBody
            step={step.key}
            form={form}
            update={update}
            jumpTo={jumpTo}
            ownerName={ownerName}
            ownerEmail={user.email}
            ownerInitials={ownerInitials}
          />

          {error ? (
            <div className="sos-banner sos-banner--warning" style={{ marginTop: '20px' }}>
              <span style={{ fontWeight: 700 }}>Heads up —</span>
              <span>{error}</span>
            </div>
          ) : null}

          <FooterNav
            stepIdx={stepIdx}
            totalSteps={totalSteps}
            isLast={isLast}
            submitting={submitting}
            goBack={goBack}
            goNext={goNext}
            handleSubmit={handleSubmit}
          />
        </div>
      </GlassCard>
    </div>
  );
}

function ProgressMeta({
  stepIdx,
  totalSteps,
  progressPct,
  jumpTo,
}: {
  stepIdx: number;
  totalSteps: number;
  progressPct: number;
  jumpTo: (idx: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span
          className="sos-eyebrow"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <span style={{ color: 'var(--sos-text-primary)', fontWeight: 700 }}>
            {stepIdx + 1}
          </span>
          <span>/ {totalSteps} steps</span>
          <span
            aria-hidden
            style={{
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: 'var(--sos-brand-primary-strong)',
            }}
          />
          <span>{progressPct}% complete</span>
        </span>
        <span
          className="sos-text-faint"
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Wizard progress
        </span>
      </div>

      <div className="sos-progress" style={{ height: '8px' }}>
        <div className="sos-progress__fill" style={{ width: progressPct + '%' }} />
      </div>

      <ol
        className="sos-no-scrollbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {STEPS.map((entry, index) => {
          const isDone = index < stepIdx;
          const isCurrent = index === stepIdx;
          const isClickable = index <= stepIdx;

          const dotBg = isDone
            ? 'var(--sos-status-success)'
            : isCurrent
              ? 'var(--sos-brand-gradient)'
              : 'var(--sos-surface-2)';
          const dotColor = isDone
            ? 'var(--sos-text-on-accent)'
            : isCurrent
              ? 'var(--sos-text-on-accent)'
              : 'var(--sos-text-faint)';
          const dotBorder = isDone || isCurrent ? '1px solid transparent' : '1px solid var(--sos-border)';

          return (
            <li
              key={entry.key}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
            >
              <button
                type="button"
                onClick={() => jumpTo(index)}
                disabled={!isClickable}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '6px 10px 6px 6px',
                  borderRadius: '999px',
                  border: isCurrent ? '1px solid var(--sos-border-accent)' : '1px solid transparent',
                  background: isCurrent ? 'var(--sos-brand-primary-soft)' : 'transparent',
                  cursor: isClickable ? 'pointer' : 'default',
                  opacity: isClickable ? 1 : 0.55,
                  transition: 'all 160ms ease',
                  fontFamily: 'inherit',
                }}
              >
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '999px',
                    display: 'grid',
                    placeItems: 'center',
                    background: dotBg,
                    color: dotColor,
                    border: dotBorder,
                    fontSize: '12px',
                    fontWeight: 700,
                    boxShadow: isCurrent ? 'var(--sos-shadow-glow)' : 'none',
                  }}
                >
                  {isDone ? <Check size={14} /> : index + 1}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: isCurrent
                      ? 'var(--sos-text-primary)'
                      : isDone
                        ? 'var(--sos-text-secondary)'
                        : 'var(--sos-text-faint)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.short}
                </span>
              </button>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  style={{
                    width: '20px',
                    height: '1px',
                    background: index < stepIdx ? 'var(--sos-status-success)' : 'var(--sos-border)',
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PromptHeader({ stepIdx, step }: { stepIdx: number; step: StepDef }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className="sos-eyebrow">
        Step {stepIdx + 1} · {step.label}
      </div>
      <h2
        className="sos-display"
        style={{
          fontSize: 'clamp(1.45rem, 2.6vw, 2rem)',
          maxWidth: '32ch',
        }}
      >
        {step.prompt}
      </h2>
      <p
        className="sos-text-secondary"
        style={{ fontSize: '14px', lineHeight: 1.65, maxWidth: '60ch' }}
      >
        {step.description}
      </p>
    </div>
  );
}

function FooterNav({
  stepIdx,
  totalSteps,
  isLast,
  submitting,
  goBack,
  goNext,
  handleSubmit,
}: {
  stepIdx: number;
  totalSteps: number;
  isLast: boolean;
  submitting: boolean;
  goBack: () => void;
  goNext: () => void;
  handleSubmit: () => void;
}) {
  return (
    <div
      style={{
        marginTop: '28px',
        paddingTop: '20px',
        borderTop: '1px solid var(--sos-divider)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      }}
    >
      <SecondaryButton
        onClick={goBack}
        disabled={stepIdx === 0}
        iconLeft={<ArrowLeft size={15} />}
      >
        Back
      </SecondaryButton>
      <div
        className="sos-text-faint"
        style={{
          fontSize: '11.5px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {stepIdx + 1} / {totalSteps}
      </div>
      {!isLast ? (
        <PrimaryButton onClick={goNext} iconRight={<ArrowRight size={15} />}>
          Continue
        </PrimaryButton>
      ) : (
        <SuccessButton
          onClick={handleSubmit}
          disabled={submitting}
          iconRight={<ArrowRight size={15} />}
        >
          {submitting ? 'Saving…' : 'Save & Go to Decision'}
        </SuccessButton>
      )}
    </div>
  );
}

function StepBody({
  step,
  form,
  update,
  jumpTo,
  ownerName,
  ownerEmail,
  ownerInitials,
}: {
  step: StepKey;
  form: FormState;
  update: UpdateFn;
  jumpTo: (idx: number) => void;
  ownerName: string;
  ownerEmail: string;
  ownerInitials: string;
}) {
  if (step === 'CLIENT') return <StepClient form={form} update={update} />;
  if (step === 'SOURCE') return <StepSource form={form} update={update} />;
  if (step === 'INTEREST') return <StepInterest form={form} update={update} />;
  if (step === 'OWNERSHIP')
    return (
      <StepOwnership
        form={form}
        update={update}
        ownerName={ownerName}
        ownerEmail={ownerEmail}
        ownerInitials={ownerInitials}
      />
    );
  if (step === 'NOTES') return <StepNotes form={form} update={update} />;
  return <StepReview form={form} jumpTo={jumpTo} />;
}

function StepClient({ form, update }: { form: FormState; update: UpdateFn }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: '20px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}
    >
      <FormInput
        label="First name"
        required
        autoFocus
        inputSize="lg"
        value={form.firstName}
        onChange={(e) => update('firstName', e.target.value)}
        placeholder="e.g. Awasi"
      />
      <FormInput
        label="Last name"
        required
        inputSize="lg"
        value={form.lastName}
        onChange={(e) => update('lastName', e.target.value)}
        placeholder="e.g. Rehman"
      />
      <FormInput
        label="Phone number"
        required
        hint="Include country code so we can WhatsApp them"
        inputSize="lg"
        iconLeft={<Phone size={15} />}
        value={form.phone}
        onChange={(e) => update('phone', e.target.value)}
        placeholder="+92 300 ..."
      />
      <FormInput
        label="Email address"
        hint="Optional but helps for visa documents later"
        inputSize="lg"
        iconLeft={<Mail size={15} />}
        type="email"
        value={form.email}
        onChange={(e) => update('email', e.target.value)}
        placeholder="client@example.com"
      />
      <div style={{ gridColumn: '1 / -1' }}>
        <InfoTip
          Icon={Sparkles}
          tone="accent"
          message={
            <>
              <strong>Tip:</strong> Type the phone number with country code so reminders and
              WhatsApp links work without re-editing.
            </>
          }
        />
      </div>
    </div>
  );
}

function StepSource({ form, update }: { form: FormState; update: UpdateFn }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <p className="sos-text-muted" style={{ fontSize: '13.5px', lineHeight: 1.6 }}>
        Pick the channel — we will auto-tag the lead so you can filter by source later.
      </p>
      <div
        style={{
          display: 'grid',
          gap: '12px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        {SOURCE_OPTIONS.map((opt) => (
          <PickTile
            key={opt.key}
            active={form.source === opt.key}
            onClick={() => update('source', opt.key)}
            Icon={opt.Icon}
            title={opt.label}
            caption={opt.caption}
            tone={opt.tone}
          />
        ))}
      </div>
    </div>
  );
}

function StepInterest({ form, update }: { form: FormState; update: UpdateFn }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Field label="Interested service" required hint="What are they looking to do?">
        {/* Native select — same `sos-input` premium styling used across
            every form in the app. Defaults to empty so sales has to
            actively pick one of the 9 canonical service types. No free
            typing — the dropdown is the only way in. */}
        <select
          className="sos-input"
          value={form.service ?? ''}
          onChange={(e) => update('service', e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="" disabled>
            Select a service…
          </option>
          {SERVICES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target country" required hint="Where do they want to go?">
        <div
          style={{
            display: 'grid',
            gap: '10px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          {COUNTRIES.map((c) => (
            <ChipBtn
              key={c}
              active={form.country === c}
              onClick={() => update('country', c)}
              label={c}
              icon={<Globe2 size={13} />}
            />
          ))}
        </div>
        {/* Any other country (Schengen, etc.) via the searchable picker. */}
        <div style={{ marginTop: 10 }}>
          <CountrySelect
            value={COUNTRIES.includes(form.country) ? '' : form.country}
            onChange={(c) => update('country', c)}
            placeholder="Search all countries…"
          />
          {form.country && !COUNTRIES.includes(form.country) ? (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sos-text-muted)' }}>
              Selected: <strong style={{ color: 'var(--sos-text-primary)' }}>{form.country}</strong>
            </div>
          ) : null}
        </div>
      </Field>
    </div>
  );
}

function StepOwnership({
  form,
  update,
  ownerName,
  ownerEmail,
  ownerInitials,
}: {
  form: FormState;
  update: UpdateFn;
  ownerName: string;
  ownerEmail: string;
  ownerInitials: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Field label="Lead temperature" required hint="How ready is the client to move forward?">
        <div
          style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {TEMP_OPTIONS.map((opt) => (
            <PickTile
              key={opt.key}
              active={form.temperature === opt.key}
              onClick={() => update('temperature', opt.key)}
              Icon={opt.Icon}
              title={opt.label}
              caption={opt.hint}
              tone={opt.tone}
            />
          ))}
        </div>
      </Field>
      <Field
        label="Assigned sales person"
        required
        hint="Auto-set to you — the lead is created in your queue."
      >
        <OwnerCard name={ownerName} email={ownerEmail} initials={ownerInitials} />
      </Field>
    </div>
  );
}

function OwnerCard({
  name,
  email,
  initials,
}: {
  name: string;
  email: string;
  initials: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '16px',
        borderRadius: 'var(--sos-radius-sm)',
        border: '1.5px solid var(--sos-border-accent)',
        background: 'var(--sos-brand-primary-soft)',
        boxShadow: 'var(--sos-shadow-glow)',
      }}
    >
      <div className="sos-avatar" aria-hidden>
        {initials}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--sos-text-primary)',
              letterSpacing: '-0.005em',
            }}
          >
            {name}
          </span>
          <StatusBadge tone="accent" size="sm">
            <Check size={11} /> You
          </StatusBadge>
        </div>
        <div
          className="sos-text-muted"
          style={{
            marginTop: '4px',
            fontSize: '12.5px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {email} · Sales owner
        </div>
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          borderRadius: '999px',
          background: 'var(--sos-surface-3)',
          border: '1px solid var(--sos-border)',
          color: 'var(--sos-text-faint)',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        <Users size={12} />
        Locked to you
      </div>
    </div>
  );
}

function StepNotes({ form, update }: { form: FormState; update: UpdateFn }) {
  const presets = [
    'Walk-in, ready to enroll this week.',
    'Asked for documents checklist; will send via WhatsApp.',
    'Wants pricing for student visa pathway.',
    'Will discuss with spouse and confirm tomorrow.',
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <FormTextarea
        label="Sales discussion notes"
        hint="Capture exactly what the client said and what you promised. Helps the next person on the case."
        autoFocus
        inputSize="lg"
        value={form.note}
        onChange={(e) => update('note', e.target.value)}
        placeholder="Example: Walk-in client. Wants Canada study visa pathway. Will pay tomorrow morning."
        style={{ minHeight: 160 }}
      />
      <div>
        <div
          className="sos-text-faint"
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}
        >
          Quick add
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => update('note', form.note ? form.note + ' ' + p : p)}
              style={{
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '999px',
                border: '1px solid var(--sos-border)',
                background: 'var(--sos-surface-1)',
                color: 'var(--sos-text-secondary)',
                cursor: 'pointer',
                transition: 'all 160ms ease',
                fontFamily: 'inherit',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = 'var(--sos-border-accent)';
                e.currentTarget.style.background = 'var(--sos-brand-primary-soft)';
                e.currentTarget.style.color = 'var(--sos-brand-primary-strong)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = 'var(--sos-border)';
                e.currentTarget.style.background = 'var(--sos-surface-1)';
                e.currentTarget.style.color = 'var(--sos-text-secondary)';
              }}
            >
              + {p}
            </button>
          ))}
        </div>
      </div>
      <InfoTip
        Icon={StickyNote}
        tone="warm"
        message={
          <>
            <strong>Heads up:</strong> Avoid putting payment numbers here — those go in
            Decisions when you take the receipt.
          </>
        }
      />
    </div>
  );
}

function StepReview({ form, jumpTo }: { form: FormState; jumpTo: (idx: number) => void }) {
  const sourceMeta = form.source ? SOURCE_OPTIONS.find((s) => s.key === form.source) : undefined;
  const tempMeta = TEMP_OPTIONS.find((t) => t.key === form.temperature) ?? TEMP_OPTIONS[1];
  const groups: Array<{ label: string; idx: number; rows: Array<{ k: string; v: string }> }> = [
    {
      label: 'Client info',
      idx: 0,
      rows: [
        { k: 'Full name', v: (form.firstName + ' ' + form.lastName).trim() || '—' },
        { k: 'Phone', v: form.phone || '—' },
        { k: 'Email', v: form.email || '—' },
      ],
    },
    {
      label: 'Lead source',
      idx: 1,
      rows: [{ k: 'Source', v: sourceMeta ? sourceMeta.label : '—' }],
    },
    {
      label: 'Service & country',
      idx: 2,
      rows: [
        { k: 'Service', v: SERVICES.find((s) => s.code === form.service)?.label ?? '—' },
        { k: 'Country', v: form.country || '—' },
      ],
    },
    {
      label: 'Owner & priority',
      idx: 3,
      rows: [
        { k: 'Temperature', v: tempMeta.label + ' — ' + tempMeta.hint },
        { k: 'Sales owner', v: form.salesPerson || '—' },
      ],
    },
    { label: 'Discussion note', idx: 4, rows: [{ k: 'Note', v: form.note || '—' }] },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="sos-banner sos-banner--success">
        <CheckCircle2 size={16} />
        <span>
          Everything looks good. Saving will move this lead to <strong>Decisions</strong> so you
          can either book a meeting or capture payment.
        </span>
      </div>
      {groups.map((g) => (
        <GlassCard key={g.label} variant="soft" padded="md">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div className="sos-eyebrow">{g.label}</div>
              <div
                className="sos-text-faint"
                style={{ fontSize: '11px', marginTop: '4px', fontWeight: 600 }}
              >
                Step {g.idx + 1}
              </div>
            </div>
            <GhostButton size="sm" onClick={() => jumpTo(g.idx)}>
              Edit
            </GhostButton>
          </div>
          <div
            style={{
              marginTop: '14px',
              display: 'grid',
              gap: '10px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            }}
          >
            {g.rows.map((r) => (
              <div
                key={r.k}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '10px 14px',
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-surface-1)',
                  border: '1px solid var(--sos-border-subtle)',
                }}
              >
                <div
                  className="sos-text-faint"
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {r.k}
                </div>
                <div
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 600,
                    color: 'var(--sos-text-primary)',
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                  }}
                >
                  {r.v}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function PickTile({
  active,
  onClick,
  Icon,
  title,
  caption,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  Icon: LucideIcon;
  title: string;
  caption: string;
  tone: string;
}) {
  const baseStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '16px',
    borderRadius: 'var(--sos-radius-sm)',
    border: active ? '1.5px solid ' + tone : '1px solid var(--sos-border)',
    background: active ? 'var(--sos-surface-3)' : 'var(--sos-surface-1)',
    boxShadow: active ? '0 0 0 3px var(--sos-surface-2), var(--sos-shadow-glow)' : 'none',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 180ms ease',
    width: '100%',
    fontFamily: 'inherit',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      style={baseStyle}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--sos-border-strong)';
          e.currentTarget.style.background = 'var(--sos-surface-3)';
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--sos-border)';
          e.currentTarget.style.background = 'var(--sos-surface-1)';
        }
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in srgb, ' + tone + ' 18%, transparent)',
          color: tone,
          border: '1px solid color-mix(in srgb, ' + tone + ' 28%, transparent)',
          flexShrink: 0,
        }}
      >
        <Icon size={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)' }}
          >
            {title}
          </span>
          {active ? (
            <span
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '999px',
                display: 'grid',
                placeItems: 'center',
                background: tone,
                color: 'var(--sos-text-on-accent)',
              }}
            >
              <Check size={12} />
            </span>
          ) : null}
        </div>
        <p
          className="sos-text-muted"
          style={{ marginTop: '4px', fontSize: '12.5px', lineHeight: 1.5 }}
        >
          {caption}
        </p>
      </div>
    </button>
  );
}

function ChipBtn({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
}) {
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 600,
    borderRadius: 'var(--sos-radius-button)',
    border: active ? '1.5px solid var(--sos-border-accent)' : '1px solid var(--sos-border)',
    background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
    color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'all 160ms ease',
    fontFamily: 'inherit',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--sos-border-strong)';
          e.currentTarget.style.color = 'var(--sos-text-primary)';
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--sos-border)';
          e.currentTarget.style.color = 'var(--sos-text-secondary)';
        }
      }}
    >
      {active ? <Check size={14} /> : icon}
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </button>
  );
}

function InfoTip({
  Icon,
  tone,
  message,
}: {
  Icon: LucideIcon;
  tone: 'accent' | 'warm';
  message: ReactNode;
}) {
  const accent = tone === 'accent' ? 'var(--sos-brand-primary-strong)' : 'var(--sos-brand-accent)';
  const bg = tone === 'accent' ? 'var(--sos-brand-primary-soft)' : 'var(--sos-brand-accent-soft)';
  const border =
    tone === 'accent' ? 'var(--sos-brand-primary-border)' : 'var(--sos-brand-accent-border)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: 'var(--sos-radius-sm)',
        background: bg,
        border: '1px solid ' + border,
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '9px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-surface-3)',
          color: accent,
          border: '1px solid ' + border,
          flexShrink: 0,
        }}
      >
        <Icon size={14} />
      </div>
      <div
        className="sos-text-secondary"
        style={{ fontSize: '12.5px', lineHeight: 1.55, flex: 1, alignSelf: 'center' }}
      >
        {message}
      </div>
    </div>
  );
}
