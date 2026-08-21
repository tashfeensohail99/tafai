'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Landmark,
  Loader2,
  Plus,
  Pencil,
  X,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  FormInput,
  FormTextarea,
} from '@/components/sales-v2/ui';
import { useJrSession } from '@/components/layout/JrShell';
import {
  fetchJrCounsel,
  createJrCounsel,
  updateJrCounsel,
  jrFmtDate,
  type JrCounsel,
  type CreateJrCounselInput,
} from '@/lib/jr';

/**
 * JR counsel directory (jr.counsel.manage). Create counsel, edit/deactivate, and
 * mark good-standing verified (today). Counsel created here become selectable as a
 * matter's counsel of record / merits assessor — the setter the RETAINED gate
 * needs. Gated end-to-end: the whole page requires jr.counsel.manage and the
 * backend re-checks it on every route.
 */

const errorBoxStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--sos-status-danger-soft)',
  border: '1px solid var(--sos-status-danger-border)',
  color: 'var(--sos-status-danger)',
  fontSize: 12.5,
};

// A good-standing verification older than this is stale (amber chip — §counsel v1).
const GOOD_STANDING_STALE_DAYS = 90;

function goodStandingChip(verifiedAt: string | null) {
  if (!verifiedAt) {
    return <StatusBadge tone="warning" size="sm" dot={false}>Not verified</StatusBadge>;
  }
  const ageDays = Math.floor((Date.now() - new Date(verifiedAt).getTime()) / 86_400_000);
  if (Number.isNaN(ageDays)) {
    return <StatusBadge tone="warning" size="sm" dot={false}>Not verified</StatusBadge>;
  }
  if (ageDays > GOOD_STANDING_STALE_DAYS) {
    return (
      <StatusBadge tone="warning" size="sm" dot={false}>
        Verified {jrFmtDate(verifiedAt)} (stale)
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" size="sm" dot={false}>
      Verified {jrFmtDate(verifiedAt)}
    </StatusBadge>
  );
}

const EMPTY_FORM: CreateJrCounselInput = {
  legalName: '',
  firmName: '',
  lawSocietyProvince: '',
  licenceNumber: '',
  email: '',
  addressForServiceCanada: '',
  directoryUrl: '',
  phone: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// Create / edit form (shared shell). `initial` present ⇒ edit mode.
// ---------------------------------------------------------------------------
function CounselForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: JrCounsel;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateJrCounselInput>(
    initial
      ? {
          legalName: initial.legalName,
          firmName: initial.firmName,
          lawSocietyProvince: initial.lawSocietyProvince,
          licenceNumber: initial.licenceNumber,
          email: initial.email,
          addressForServiceCanada: initial.addressForServiceCanada,
          directoryUrl: initial.directoryUrl ?? '',
          phone: initial.phone ?? '',
          notes: initial.notes ?? '',
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateJrCounselInput>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const required: Array<[keyof CreateJrCounselInput, string]> = [
      ['legalName', 'Legal name'],
      ['firmName', 'Firm name'],
      ['lawSocietyProvince', 'Law society province'],
      ['licenceNumber', 'Licence number'],
      ['email', 'Email'],
      ['addressForServiceCanada', 'Address for service'],
    ];
    for (const [key, label] of required) {
      if (!String(form[key] ?? '').trim()) {
        setError(`${label} is required.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const payload: CreateJrCounselInput = {
        legalName: form.legalName.trim(),
        firmName: form.firmName.trim(),
        lawSocietyProvince: form.lawSocietyProvince.trim(),
        licenceNumber: form.licenceNumber.trim(),
        email: form.email.trim(),
        addressForServiceCanada: form.addressForServiceCanada.trim(),
        directoryUrl: form.directoryUrl?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      };
      if (initial) {
        await updateJrCounsel(initial.id, payload);
      } else {
        await createJrCounsel(payload);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save counsel');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormInput
          label="Legal name"
          value={form.legalName}
          onChange={(e) => set('legalName', e.target.value)}
          maxLength={200}
          required
          placeholder="e.g. Jane A. Barrister"
        />
        <FormInput
          label="Firm name"
          value={form.firmName}
          onChange={(e) => set('firmName', e.target.value)}
          maxLength={200}
          required
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormInput
          label="Law society province"
          value={form.lawSocietyProvince}
          onChange={(e) => set('lawSocietyProvince', e.target.value)}
          maxLength={40}
          required
          placeholder="e.g. ON"
        />
        <FormInput
          label="Licence number"
          value={form.licenceNumber}
          onChange={(e) => set('licenceNumber', e.target.value)}
          maxLength={60}
          required
          placeholder="e.g. 76888B"
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          maxLength={200}
          required
        />
        <FormInput
          label="Phone (optional)"
          value={form.phone ?? ''}
          onChange={(e) => set('phone', e.target.value)}
          maxLength={40}
        />
      </div>
      <FormInput
        label="Address for service (Canada)"
        value={form.addressForServiceCanada}
        onChange={(e) => set('addressForServiceCanada', e.target.value)}
        maxLength={400}
        required
      />
      <FormInput
        label="Directory URL (optional)"
        value={form.directoryUrl ?? ''}
        onChange={(e) => set('directoryUrl', e.target.value)}
        maxLength={500}
        placeholder="Law society directory listing"
      />
      <FormTextarea
        label="Notes (optional)"
        value={form.notes ?? ''}
        onChange={(e) => set('notes', e.target.value)}
        maxLength={4000}
        rows={2}
      />

      {error ? <div style={errorBoxStyle}>{error}</div> : null}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <SecondaryButton type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          type="submit"
          disabled={saving}
          iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <Plus size={14} />}
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add counsel'}
        </PrimaryButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One counsel row — details + inline actions (edit / activate-deactivate /
// mark good standing verified today).
// ---------------------------------------------------------------------------
function CounselRow({ counsel, onChanged }: { counsel: JrCounsel; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(action: 'toggleActive' | 'verify') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'toggleActive') {
        await updateJrCounsel(counsel.id, { isActive: !counsel.isActive });
      } else {
        await updateJrCounsel(counsel.id, {
          goodStandingVerifiedAt: new Date().toISOString(),
        });
      }
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update counsel');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--sos-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: counsel.isActive ? 1 : 0.68,
      }}
    >
      {editing ? (
        <CounselForm
          initial={counsel}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                  {counsel.legalName}
                </span>
                {!counsel.isActive ? (
                  <StatusBadge tone="neutral" size="sm" dot={false}>Inactive</StatusBadge>
                ) : null}
                {goodStandingChip(counsel.goodStandingVerifiedAt)}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 3 }}>
                {counsel.firmName} · {counsel.lawSocietyProvince} #{counsel.licenceNumber}
              </div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                {counsel.email}
                {counsel.phone ? ` · ${counsel.phone}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                {counsel.addressForServiceCanada}
              </div>
              {counsel.directoryUrl ? (
                <a
                  href={counsel.directoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', marginTop: 4 }}
                >
                  <ExternalLink size={12} /> Directory listing
                </a>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <SecondaryButton type="button" onClick={() => setEditing(true)} disabled={busy} iconLeft={<Pencil size={13} />}>
                Edit
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={() => patch('verify')}
                disabled={busy}
                iconLeft={busy ? <Loader2 size={13} className="sos-spin" /> : <ShieldCheck size={13} />}
              >
                Mark verified today
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => patch('toggleActive')} disabled={busy}>
                {counsel.isActive ? 'Deactivate' : 'Reactivate'}
              </SecondaryButton>
            </div>
          </div>
          {counsel.notes ? (
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', lineHeight: 1.5 }}>{counsel.notes}</div>
          ) : null}
          {error ? <div style={errorBoxStyle}>{error}</div> : null}
        </>
      )}
    </div>
  );
}

export default function JrCounselDirectoryPage() {
  const { user } = useJrSession();
  const canManage = user.permissions.includes('jr.counsel.manage');

  const [rows, setRows] = useState<JrCounsel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJrCounsel(false)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load counsel');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [canManage, reloadKey]);

  const visible = useMemo(
    () => (showInactive ? rows : rows.filter((r) => r.isActive)),
    [rows, showInactive],
  );

  function reload() {
    setReloadKey((k) => k + 1);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Retention"
        title="Counsel directory"
        description="Counsel of record candidates and merits assessors. Add counsel here so they can be set on a matter."
        actions={
          canManage && !creating ? (
            <PrimaryButton type="button" onClick={() => setCreating(true)} iconLeft={<Plus size={14} />}>
              Add counsel
            </PrimaryButton>
          ) : undefined
        }
      />

      {!canManage ? (
        <EmptyState
          Icon={Landmark}
          title="Counsel management only"
          description="The counsel directory is available to staff with counsel-management access."
        />
      ) : (
        <>
          {creating ? (
            <GlassCard variant="panel" padded="md">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Landmark size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>New counsel</div>
                </div>
                <SecondaryButton type="button" onClick={() => setCreating(false)} iconLeft={<X size={14} />}>
                  Cancel
                </SecondaryButton>
              </div>
              <CounselForm
                onCancel={() => setCreating(false)}
                onSaved={() => {
                  setCreating(false);
                  reload();
                }}
              />
            </GlassCard>
          ) : null}

          <GlassCard variant="panel" padded={false}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-muted)' }}>
                {visible.length} counsel
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sos-text-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                Show inactive
              </label>
            </div>

            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Loader2 size={14} className="sos-spin" /> Loading…
              </div>
            ) : error ? (
              <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load counsel: {error}</div>
            ) : visible.length === 0 ? (
              <div style={{ padding: 8 }}>
                <EmptyState
                  Icon={Landmark}
                  title="No counsel yet"
                  description="Add counsel so they can be set as a matter's counsel of record or merits assessor."
                />
              </div>
            ) : (
              visible.map((c) => <CounselRow key={c.id} counsel={c} onChanged={reload} />)
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
