'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Info, Pencil, Search } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { FormInput } from '@/components/sales-v2/ui/FormFields';
import { getHandles, updateHandle, type HandleRow } from '@/lib/social-engagement';

export default function SocialHandlesPage() {
  const [rows, setRows] = useState<HandleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<HandleRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getHandles()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  const submittedCount = rows.filter((r) => r.submittedAt).length;
  const missingCount = rows.filter((r) => !r.instagramHandle).length;

  // ONE shared link everyone uses — employees identify by their name + phone.
  const sharedLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/onboarding/social-handles`;

  const copyShared = async () => {
    try {
      await navigator.clipboard.writeText(sharedLink);
      setCopied('shared');
      setTimeout(() => setCopied((c) => (c === 'shared' ? null : c)), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Social Handles"
        description="Share one link with the whole team to self-submit profiles, and monitor who's filled it in."
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.6 }}>
            Share <strong>one link</strong> with the whole team (no login) — each person enters their <strong>name &amp; company phone number</strong> to
            identify themselves, then adds their handles. The <strong>Instagram handle</strong> is what makes their IG comments verify
            automatically; the other platforms are reference (we confirm links are well-formed and open, not that the profile exists).
            You can also edit any rep&apos;s handles directly below.
          </div>
        </div>
      </GlassCard>

      {/* The one shared link to send to all employees. */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-tertiary,#6b7280)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Shared form link</span>
          <code style={{ flex: 1, minWidth: 200, fontSize: 13, padding: '8px 10px', borderRadius: 8, background: 'var(--sos-border-subtle, rgba(0,0,0,0.05))', color: 'var(--sos-text-primary,#111827)', overflowX: 'auto', whiteSpace: 'nowrap' }}>{sharedLink}</code>
          <button type="button" onClick={copyShared} style={copyBtn}>
            {copied === 'shared' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
          </button>
          <a href={sharedLink} target="_blank" rel="noopener noreferrer" style={{ ...copyBtn, textDecoration: 'none' }}>
            <ExternalLink size={14} /> Open
          </a>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label="Submitted" value={loading ? '…' : `${submittedCount} / ${rows.length}`} tone="#059669" />
        <Stat label="Missing IG handle" value={loading ? '…' : String(missingCount)} tone={missingCount > 0 ? '#d97706' : '#6b7280'} />
      </div>

      <div style={{ position: 'relative', maxWidth: 280 }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-tertiary, #6b7280)' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rep…"
          style={{ padding: '8px 10px 8px 30px', borderRadius: 10, border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))', background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-primary, #111827)', fontSize: 13, width: '100%' }}
        />
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} /> <span>{error}</span>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard variant="default">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={th}>Rep</th>
                <th style={th}>Submitted</th>
                <th style={{ ...th, textAlign: 'center' }}>IG</th>
                <th style={{ ...th, textAlign: 'center' }}>FB</th>
                <th style={{ ...th, textAlign: 'center' }}>LinkedIn</th>
                <th style={{ ...th, textAlign: 'center' }}>TikTok</th>
                <th style={{ ...th, textAlign: 'center' }}>YT</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.employeeId}>
                  <td style={cell}>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    {!r.isActive ? <span style={inactivePill}>inactive</span> : null}
                  </td>
                  <td style={{ ...cell, color: 'var(--sos-text-tertiary,#6b7280)', fontSize: 12 }}>
                    {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : <span style={{ color: '#d97706' }}>not yet</span>}
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <LinkCell url={r.instagramUrl} missing={!r.instagramHandle} missingWarn />
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}><LinkCell url={r.facebookProfileUrl} missing={!r.facebookProfileUrl} /></td>
                  <td style={{ ...cell, textAlign: 'center' }}><LinkCell url={r.linkedinUrl} missing={!r.linkedinUrl} /></td>
                  <td style={{ ...cell, textAlign: 'center' }}><LinkCell url={r.tiktokUrl} missing={!r.tiktokHandle} /></td>
                  <td style={{ ...cell, textAlign: 'center' }}><LinkCell url={r.youtubeChannelUrl} missing={!r.youtubeChannelUrl} /></td>
                  <td style={cell}>
                    <button type="button" onClick={() => setEditing(r)} style={iconBtn} aria-label="Edit handles">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...cell, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)', padding: 20 }}>
                    {q ? 'No rep matches your search.' : 'No employees found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {editing ? <EditModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function LinkCell({ url, missing, missingWarn }: { url: string | null; missing: boolean; missingWarn?: boolean }) {
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={url} style={{ color: '#2563eb', display: 'inline-flex' }}>
        <ExternalLink size={15} />
      </a>
    );
  }
  return <span style={{ color: missingWarn ? '#d97706' : 'var(--sos-text-tertiary,#9ca3af)' }}>—</span>;
}

function EditModal({ row, onClose, onSaved }: { row: HandleRow; onClose: () => void; onSaved: () => void }) {
  const [instagram, setInstagram] = useState(row.instagramHandle ?? '');
  const [facebook, setFacebook] = useState(row.facebookProfileUrl ?? '');
  const [linkedin, setLinkedin] = useState(row.linkedinUrl ?? '');
  const [tiktok, setTiktok] = useState(row.tiktokHandle ?? '');
  const [youtube, setYoutube] = useState(row.youtubeChannelUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await updateHandle(row.employeeId, {
        instagramHandle: instagram.trim() || null,
        facebookProfileUrl: facebook.trim() || null,
        linkedinUrl: linkedin.trim() || null,
        tiktokHandle: tiktok.trim() || null,
        youtubeChannelUrl: youtube.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-sos-modal="" style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 2px', fontSize: 17 }}>Edit handles</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--sos-text-secondary,#4b5563)' }}>{row.name} — accepts a username or a full profile URL.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormInput label="Instagram username" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@username" />
          <FormInput label="Facebook profile" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="facebook.com/… or username" />
          <FormInput label="LinkedIn profile" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/…" />
          <FormInput label="TikTok username" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="@username" />
          <FormInput label="YouTube channel" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="youtube.com/@channel" />
          {err ? <div className="sos-help sos-help--error">{err}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <GlassCard variant="default">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-tertiary, #6b7280)' }}>{label}</span>
        <span style={{ fontSize: 24, fontWeight: 700, color: tone, lineHeight: 1 }}>{value}</span>
      </div>
    </GlassCard>
  );
}

const cell: React.CSSProperties = { padding: '9px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))', verticalAlign: 'middle' };
const th: React.CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--sos-text-tertiary, #6b7280)',
};
const inactivePill: React.CSSProperties = { marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))', color: 'var(--sos-text-tertiary, #6b7280)' };
const copyBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))', background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-secondary, #4b5563)', fontSize: 12, cursor: 'pointer' };
const iconBtn: React.CSSProperties = { display: 'inline-flex', padding: 6, borderRadius: 8, border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))', background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-secondary, #4b5563)', cursor: 'pointer' };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const modal: React.CSSProperties = { background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-primary, #111827)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };
const primaryBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--sos-brand-primary-strong, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))', background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-secondary, #4b5563)', fontSize: 13, cursor: 'pointer' };
