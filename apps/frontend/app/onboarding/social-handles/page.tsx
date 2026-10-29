'use client';

import { useState } from 'react';
import { lookupByEmail, submitByEmail, previewUrl, type SocialField } from '@/lib/public-social-handles';

const NAVY = '#0f2a4a';
const BLUE = '#2563eb';
const BG = '#f4f6fb';

type Step = 'email' | 'form' | 'done';

export default function SocialHandleIntakePage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [resubmitting, setResubmitting] = useState(false);

  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [youtube, setYoutube] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function findMe() {
    setBusy(true);
    setError(null);
    try {
      const r = await lookupByEmail(email.trim());
      if (!r.found) {
        setError('We couldn’t find a team member with that work email. Please use your company email, or contact admin.');
        return;
      }
      setName(r.name ?? '');
      setResubmitting(!!r.submittedAt);
      setInstagram(r.instagram ?? '');
      setFacebook(r.facebookUrl ?? '');
      setLinkedin(r.linkedinUrl ?? '');
      setTiktok(r.tiktok ?? '');
      setYoutube(r.youtube ?? '');
      setStep('form');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not look up that email.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await submitByEmail({
        email: email.trim(),
        instagram: instagram.trim(),
        facebookUrl: facebook.trim() || undefined,
        linkedinUrl: linkedin.trim() || undefined,
        tiktok: tiktok.trim() || undefined,
        youtube: youtube.trim() || undefined,
      });
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px', color: NAVY }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.01em' }}>Tashfeen</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>Team social profiles</div>
        </div>

        {step === 'email' ? (
          <Card>
            <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Register your social profiles</h2>
            <p style={{ color: '#475569', fontSize: 13.5, lineHeight: 1.55, margin: '0 0 16px' }}>
              Enter your <strong>work email</strong> to get started. We&apos;ll match it to your staff record.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.trim()) void findMe(); }}
              placeholder="you@company.com"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={inputStyle(false)}
            />
            {error ? <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{error}</div> : null}
            <button
              type="button"
              onClick={findMe}
              disabled={busy || !email.trim()}
              style={{ ...btnPrimary, width: '100%', marginTop: 16, opacity: busy || !email.trim() ? 0.6 : 1 }}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </Card>
        ) : step === 'form' ? (
          <Card>
            <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Your social profiles</h2>
            <p style={{ color: '#475569', fontSize: 13.5, lineHeight: 1.55, margin: '0 0 6px' }}>
              Submitting as <strong>{name}</strong>{' '}
              <button type="button" onClick={() => { setStep('email'); setError(null); }} style={linkBtn}>(not you?)</button>
            </p>
            <p style={{ color: '#64748b', fontSize: 12.5, lineHeight: 1.5, margin: '0 0 18px', background: '#eef2ff', borderRadius: 10, padding: '10px 12px' }}>
              Your <strong>Instagram username</strong> is required — it&apos;s how we recognise your comments on our posts. The rest are optional.
            </p>

            <HandleField label="Instagram username" field="instagram" placeholder="@yourusername" value={instagram} onChange={setInstagram} required hint="Required." />
            <HandleField label="Facebook profile" field="facebook" placeholder="facebook.com/you or username" value={facebook} onChange={setFacebook} />
            <HandleField label="LinkedIn profile" field="linkedin" placeholder="linkedin.com/in/you" value={linkedin} onChange={setLinkedin} />
            <HandleField label="TikTok username" field="tiktok" placeholder="@yourusername" value={tiktok} onChange={setTiktok} />
            <HandleField label="YouTube channel" field="youtube" placeholder="youtube.com/@yourchannel" value={youtube} onChange={setYoutube} />

            {error ? <div style={{ color: '#b91c1c', fontSize: 13, margin: '4px 0 12px' }}>{error}</div> : null}
            <button
              type="button"
              onClick={submit}
              disabled={busy || instagram.trim().length === 0}
              style={{ ...btnPrimary, width: '100%', opacity: busy || !instagram.trim() ? 0.6 : 1 }}
            >
              {busy ? 'Saving…' : resubmitting ? 'Update my profiles' : 'Submit'}
            </button>
          </Card>
        ) : (
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <h2 style={{ fontSize: 18, margin: '8px 0 6px' }}>Thank you, {name.split(' ')[0]}!</h2>
              <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                Your social profiles are saved. You can reopen this page anytime to update them.
              </p>
              <button type="button" onClick={() => setStep('form')} style={{ ...btnGhost, marginTop: 16 }}>Edit again</button>
            </div>
          </Card>
        )}

        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 16 }}>
          Tashfeen — team engagement
        </p>
      </div>
    </div>
  );
}

function HandleField({
  label, field, placeholder, value, onChange, required, hint,
}: {
  label: string; field: SocialField; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean; hint?: string;
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
        style={inputStyle(malformed)}
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
  return <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 10px 40px rgba(15,42,74,0.08)' }}>{children}</div>;
}

function inputStyle(bad: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '11px 12px', borderRadius: 10,
    border: `1px solid ${bad ? '#fca5a5' : '#cbd5e1'}`,
    fontSize: 15, background: '#fff', color: NAVY, outline: 'none', boxSizing: 'border-box',
  };
}

const btnPrimary: React.CSSProperties = { padding: '12px 16px', borderRadius: 10, border: 'none', background: BLUE, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '9px 16px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: NAVY, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: BLUE, fontSize: 12.5, cursor: 'pointer', padding: 0 };
