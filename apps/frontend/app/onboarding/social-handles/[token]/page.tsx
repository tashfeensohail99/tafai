'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getIntakePrefill,
  submitIntake,
  previewUrl,
  type IntakePrefill,
  type SocialField,
} from '@/lib/public-social-handles';

const NAVY = '#0f2a4a';
const BLUE = '#2563eb';
const BG = '#f4f6fb';

export default function SocialHandleIntakePage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params?.token) ? params.token[0] : params?.token ?? '';

  const [prefill, setPrefill] = useState<IntakePrefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [tiktok, setTiktok] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    getIntakePrefill(token)
      .then((p) => {
        setPrefill(p);
        setInstagram(p.instagram ?? '');
        setFacebook(p.facebookUrl ?? '');
        setLinkedin(p.linkedinUrl ?? '');
        setTiktok(p.tiktok ?? '');
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await submitIntake(token, {
        instagram: instagram.trim(),
        facebookUrl: facebook.trim() || undefined,
        linkedinUrl: linkedin.trim() || undefined,
        tiktok: tiktok.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px', color: NAVY }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.01em' }}>Tashfeen</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>Team social profiles</div>
        </div>

        {loading ? (
          <Card><p style={{ textAlign: 'center', color: '#64748b', margin: 0 }}>Loading…</p></Card>
        ) : loadError ? (
          <Card>
            <h2 style={{ fontSize: 17, margin: '0 0 6px' }}>Link not valid</h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>{loadError}</p>
          </Card>
        ) : done ? (
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <h2 style={{ fontSize: 18, margin: '8px 0 6px' }}>Thank you, {prefill?.name.split(' ')[0]}!</h2>
              <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                Your social profiles are saved. You can reopen this link anytime to update them.
              </p>
              <button type="button" onClick={() => setDone(false)} style={{ ...btnGhost, marginTop: 16 }}>
                Edit again
              </button>
            </div>
          </Card>
        ) : (
          <Card>
            <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Your social profiles</h2>
            <p style={{ color: '#475569', fontSize: 13.5, lineHeight: 1.55, margin: '0 0 6px' }}>
              Submitting as <strong>{prefill?.name}</strong>. Add the accounts you use to engage with our posts.
            </p>
            <p style={{ color: '#64748b', fontSize: 12.5, lineHeight: 1.5, margin: '0 0 18px', background: '#eef2ff', borderRadius: 10, padding: '10px 12px' }}>
              We verify <strong>comments</strong>, not likes — Instagram&apos;s reads the commenter&apos;s username, so your
              Instagram username is required. We can&apos;t verify who liked a post (the platforms don&apos;t expose that).
            </p>

            <HandleField
              label="Instagram username"
              field="instagram"
              placeholder="@yourusername"
              value={instagram}
              onChange={setInstagram}
              required
              hint="Required — this is what we match your comments against."
            />
            <HandleField label="Facebook profile" field="facebook" placeholder="facebook.com/you or username" value={facebook} onChange={setFacebook} />
            <HandleField label="LinkedIn profile" field="linkedin" placeholder="linkedin.com/in/you" value={linkedin} onChange={setLinkedin} />
            <HandleField label="TikTok username" field="tiktok" placeholder="@yourusername" value={tiktok} onChange={setTiktok} />

            {error ? (
              <div style={{ color: '#b91c1c', fontSize: 13, margin: '4px 0 12px' }}>{error}</div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={submitting || instagram.trim().length === 0}
              style={{ ...btnPrimary, width: '100%', opacity: submitting || !instagram.trim() ? 0.6 : 1 }}
            >
              {submitting ? 'Saving…' : prefill?.submittedAt ? 'Update my profiles' : 'Submit'}
            </button>
          </Card>
        )}

        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 16 }}>
          This link is personal to you. Please don&apos;t forward it.
        </p>
      </div>
    </div>
  );
}

function HandleField({
  label,
  field,
  placeholder,
  value,
  onChange,
  required,
  hint,
}: {
  label: string;
  field: SocialField;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
}) {
  const preview = previewUrl(field, value);
  const malformed = value.trim().length > 0 && !preview;
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
        {label}
        {required ? <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span> : <span style={{ color: '#94a3b8', fontWeight: 400 }}> (optional)</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        style={{
          width: '100%',
          padding: '11px 12px',
          borderRadius: 10,
          border: `1px solid ${malformed ? '#fca5a5' : '#cbd5e1'}`,
          fontSize: 15,
          background: '#fff',
          color: NAVY,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ minHeight: 18, marginTop: 5, fontSize: 12 }}>
        {preview ? (
          <a href={preview} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, textDecoration: 'none', fontWeight: 600 }}>
            Open profile ↗ <span style={{ color: '#94a3b8', fontWeight: 400 }}>— check it loads</span>
          </a>
        ) : malformed ? (
          <span style={{ color: '#b45309' }}>Enter a valid username or profile link.</span>
        ) : hint ? (
          <span style={{ color: '#94a3b8' }}>{hint}</span>
        ) : null}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 10px 40px rgba(15,42,74,0.08)' }}>{children}</div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 10,
  border: 'none',
  background: BLUE,
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: NAVY,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
