'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Crown, User, UserPlus, Users } from 'lucide-react';
import { fetchClientFamily, createDependentApplicant, type ClientFamily } from '@/lib/clients-family';

/**
 * "Applicants (family)" panel for the finance customer profile. Shows the payer
 * + every dependent applicant grouped under them, each with its own file number,
 * and lets the office add a new family member (a dependent with its own file /
 * case, sharing the payer's contact — no fake phone needed).
 */
export function FamilyApplicantsCard({ clientId }: { clientId: string }) {
  const [family, setFamily] = useState<ClientFamily | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cnic, setCnic] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFamily(await fetchClientFamily(clientId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!family) return;
    setSaving(true);
    try {
      await createDependentApplicant(family.payer.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        cnic: cnic.trim() || undefined,
      });
      setFirstName('');
      setLastName('');
      setCnic('');
      setAdding(false);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Fail quietly — never break the profile page over this optional panel.
  if (loading || error || !family) return null;

  const canSave = firstName.trim().length > 0 && lastName.trim().length > 0 && !saving;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Users size={16} color="var(--sos-brand-primary-strong, #2563eb)" />
        <strong style={{ fontSize: 14 }}>Applicants</strong>
        <span style={{ fontSize: 12, color: 'var(--sos-text-faint, #9ca3af)' }}>
          One payer, {family.dependents.length + 1} applicant{family.dependents.length === 0 ? '' : 's'} — each with its own file.
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row icon={<Crown size={13} color="#d97706" />} name={family.payer.name} file={family.payer.referenceCode} sub={family.payer.phone ?? family.payer.email ?? 'payer'} count={family.payer.agreementCount} tag="PAYER" />
        {family.dependents.map((d) => (
          <Row key={d.id} icon={<User size={13} color="var(--sos-text-faint, #9ca3af)" />} name={d.name} file={d.referenceCode} sub={d.cnic ? `CNIC ${d.cnic}` : 'dependent'} count={d.agreementCount} />
        ))}
      </div>

      {adding ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" style={{ ...input, flex: 1, minWidth: 120 }} />
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" style={{ ...input, flex: 1, minWidth: 120 }} />
          </div>
          <input value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="CNIC (optional)" style={input} />
          <div style={{ fontSize: 11, color: 'var(--sos-text-faint, #9ca3af)' }}>
            Creates a new applicant with its own file number under this payer — no phone needed. Move an agreement onto it from the agreement.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setAdding(false)} style={btnGhost}>Cancel</button>
            <button type="button" onClick={save} disabled={!canSave} style={{ ...btnPrimary, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Adding…' : 'Add applicant'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ ...btnGhost, marginTop: 12, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <UserPlus size={13} /> Add applicant
        </button>
      )}
    </div>
  );
}

function Row({ icon, name, file, sub, count, tag }: { icon: React.ReactNode; name: string; file: string; sub: string; count: number; tag?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--sos-radius-md, 10px)', border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))' }}>
      <span style={{ flex: '0 0 auto' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary, #111827)' }}>
          {name} {tag ? <span style={{ fontSize: 10, fontWeight: 700, color: '#d97706', marginLeft: 4 }}>{tag}</span> : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--sos-text-faint, #9ca3af)' }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--sos-text-secondary, #4b5563)' }}>{file}</div>
        <div style={{ fontSize: 11, color: 'var(--sos-text-faint, #9ca3af)' }}>{count} agreement{count === 1 ? '' : 's'}</div>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: 'var(--sos-surface-primary, #ffffff)',
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
  borderRadius: 'var(--sos-radius-lg, 14px)',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
};
const input: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
  borderRadius: 'var(--sos-radius-md, 10px)',
  background: 'var(--sos-surface-primary, #ffffff)',
  color: 'var(--sos-text-primary, #111827)',
};
const btnGhost: CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
  borderRadius: 'var(--sos-radius-md, 10px)',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--sos-text-secondary, #4b5563)',
};
const btnPrimary: CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--sos-brand-primary-border, rgba(37,99,235,0.30))',
  borderRadius: 'var(--sos-radius-md, 10px)',
  background: 'var(--sos-brand-primary-strong, #2563eb)',
  color: '#ffffff',
};
