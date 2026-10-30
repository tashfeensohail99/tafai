'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { getMyHandleStatus, submitMyHandles } from '@/lib/social-engagement';
import { previewUrl, type SocialField } from '@/lib/public-social-handles';

/**
 * In-app nudge: any logged-in employee who hasn't registered their social
 * handles gets a dismissible popup to fill them right here (identity comes from
 * their session — no name/phone needed). Mounted once in the root layout so it
 * appears across every CRM shell. Hidden on the public form + auth pages, and
 * snoozable for a day so it never becomes a nag.
 */
const SNOOZE_KEY = 'tafsheen-social-prompt-snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? '0');
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

export function SocialHandlePrompt() {
  const session = useSession();
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');

  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [youtube, setYoutube] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Never on the public form itself or auth screens.
  const suppressed = pathname?.startsWith('/onboarding') || pathname?.startsWith('/login') || pathname?.startsWith('/reset-password');

  useEffect(() => {
    if (session.status !== 'authed' || suppressed || snoozed()) return;
    let alive = true;
    getMyHandleStatus()
      .then((s) => {
        if (!alive) return;
        if (s.isEmployee && !s.submitted) {
          setName(s.name ?? '');
          setInstagram(s.instagram ?? '');
          setFacebook(s.facebookUrl ?? '');
          setLinkedin(s.linkedinUrl ?? '');
          setTiktok(s.tiktok ?? '');
          setYoutube(s.youtube ?? '');
          setShow(true);
        }
      })
      .catch(() => {/* best-effort — never block the app */});
    return () => { alive = false; };
  }, [session.status, suppressed]);

  if (!show) return null;

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch {/* ignore */}
    setShow(false);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitMyHandles({
        instagram: instagram.trim(),
        facebookUrl: facebook.trim() || undefined,
        linkedinUrl: linkedin.trim() || undefined,
        tiktok: tiktok.trim() || undefined,
        youtube: youtube.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true">
      <div style={modal}>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h3 style={{ fontSize: 18, margin: '8px 0 6px', color: 'var(--sos-text-primary, #0f172a)' }}>
              Thank you{name ? `, ${name.split(' ')[0]}` : ''}!
            </h3>
            <p style={{ fontSize: 14, color: 'var(--sos-text-secondary, #475569)', margin: '0 0 16px' }}>
              Your social profiles are saved.
            </p>
            <button type="button" onClick={() => setShow(false)} style={btnPrimary}>Close</button>
          </div>
        ) : (
          <>
            <h3 style={{ fontSize: 17, margin: '0 0 4px', color: 'var(--sos-text-primary, #0f172a)' }}>📣 Register your social profiles</h3>
            <p style={{ fontSize: 13, color: 'var(--sos-text-secondary, #475569)', lineHeight: 1.5, margin: '0 0 14px' }}>
              {name ? <>Hi {name.split(' ')[0]} — a</> : <>A</>}dd the accounts you use to like &amp; comment on our company posts.
              Your <strong>Instagram username</strong> is required — it&apos;s how your comments get credited to you.
            </p>

            <Field label="Instagram username" field="instagram" value={instagram} onChange={setInstagram} placeholder="@yourusername" required />
            <Field label="Facebook profile" field="facebook" value={facebook} onChange={setFacebook} placeholder="facebook.com/you" />
            <Field label="LinkedIn profile" field="linkedin" value={linkedin} onChange={setLinkedin} placeholder="linkedin.com/in/you" />
            <Field label="TikTok username" field="tiktok" value={tiktok} onChange={setTiktok} placeholder="@yourusername" />
            <Field label="YouTube channel" field="youtube" value={youtube} onChange={setYoutube} placeholder="youtube.com/@you" />

            {error ? <div style={{ color: '#b91c1c', fontSize: 13, margin: '2px 0 10px' }}>{error}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={snooze} style={btnGhost}>Remind me later</button>
              <button type="button" onClick={submit} disabled={busy || !instagram.trim()} style={{ ...btnPrimary, opacity: busy || !instagram.trim() ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, field, value, onChange, placeholder, required }: {
  label: string; field: SocialField; value: string; onChange: (v: string) => void; placeholder: string; required?: boolean;
}) {
  const preview = previewUrl(field, value);
  const malformed = value.trim().length > 0 && !preview;
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--sos-text-primary, #0f172a)' }}>
        {label}{required ? <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span> : <span style={{ color: '#94a3b8', fontWeight: 400 }}> (optional)</span>}
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
          width: '100%', padding: '9px 11px', borderRadius: 9, fontSize: 14, boxSizing: 'border-box',
          border: `1px solid ${malformed ? '#fca5a5' : 'var(--sos-border-subtle, #cbd5e1)'}`,
          background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-primary, #0f172a)', outline: 'none',
        }}
      />
      {preview ? (
        <a href={preview} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Open profile ↗</a>
      ) : malformed ? (
        <span style={{ fontSize: 11.5, color: '#b45309' }}>Enter a valid username or profile link.</span>
      ) : null}
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const modal: React.CSSProperties = {
  background: 'var(--sos-surface, #fff)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440,
  maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
};
const btnPrimary: React.CSSProperties = { padding: '9px 16px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '9px 14px', borderRadius: 10, border: '1px solid var(--sos-border-subtle, #cbd5e1)', background: 'transparent', color: 'var(--sos-text-secondary, #475569)', fontSize: 14, cursor: 'pointer' };
