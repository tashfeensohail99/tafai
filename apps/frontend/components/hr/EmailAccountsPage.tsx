'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, MailCheck, MailWarning, MailX, Loader2, KeyRound, Wand2 } from 'lucide-react';
import { PageHeader, GlassCard, MetricCard, PrimaryButton, SecondaryButton } from '@/components/sales-v2/ui';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useHrSession } from '../layout/HrShell';
import { CredentialCard, ModalShell } from './HrDirectory';
import { initials, avatarGradient, th, td, StatusPill } from './ui';
import { getEmailAccounts, provisionMailbox, type EmailAccountsResult, type EmailAccountRow, type ProvisionResult } from '@/lib/hr';

const STATUS: Record<EmailAccountRow['status'], { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  linked: { label: 'Active email', tone: 'success' },
  unlinked: { label: 'Mailbox unused', tone: 'warning' },
  missing: { label: 'No email', tone: 'danger' },
};

export default function EmailAccountsPage() {
  const { user } = useHrSession();
  const can = (k: string) => user?.permissions?.includes(k) ?? false;
  const [data, setData] = useState<EmailAccountsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<EmailAccountRow | null>(null);
  const [filter, setFilter] = useState<EmailAccountRow['status'] | null>(null);

  const load = useCallback(async () => {
    try { setErr(null); setData(await getEmailAccounts()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);

  useEffect(() => { if (can('hr.view')) void load(); /* eslint-disable-next-line */ }, []);
  if (!can('hr.view')) return <PermissionDeniedState />;

  const shown = data ? (filter ? data.rows.filter((r) => r.status === filter) : data.rows) : [];

  return (
    <div className="sos-stack" style={{ gap: 20 }}>
      <PageHeader eyebrow="Human Resources" title="Email Accounts"
        description={`Business email status across the team${data ? ` · @${data.domain}` : ''}. Create missing mailboxes or activate dormant ones.`} />

      {data && !data.configured ? (
        <GlassCard><div style={{ padding: 12, color: 'var(--sos-text-muted)' }}>MXRoute isn’t configured — provisioning is disabled.</div></GlassCard>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
        <MetricCard label="Active business email" value={data?.counts.linked ?? 0} tone="success" Icon={MailCheck}
          hint="Login is their @domain email" onClick={() => setFilter((f) => (f === 'linked' ? null : 'linked'))} active={filter === 'linked'} />
        <MetricCard label="Mailbox unused" value={data?.counts.unlinked ?? 0} tone="warning" Icon={MailWarning}
          hint="Exists but not their login" onClick={() => setFilter((f) => (f === 'unlinked' ? null : 'unlinked'))} active={filter === 'unlinked'} />
        <MetricCard label="No email" value={data?.counts.missing ?? 0} tone="danger" Icon={MailX}
          hint="Needs a mailbox" onClick={() => setFilter((f) => (f === 'missing' ? null : 'missing'))} active={filter === 'missing'} />
      </div>

      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--sos-divider)' }}>
          <div className="sos-eyebrow">{filter ? STATUS[filter].label : 'All staff'} · {shown.length}</div>
          {filter ? <button onClick={() => setFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--sos-brand-primary-strong)' }}>Show all</button> : null}
        </div>

        {err ? <div style={{ padding: 20 }}><ErrorState message={err} onRetry={load} /></div>
          : !data ? <div style={{ padding: 20 }}><LoadingState /></div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['Employee', 'Branch', 'CRM login', 'Business mailbox', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const s = STATUS[r.status];
                    const [fn, ...rest] = r.name.split(' ');
                    return (
                      <tr key={r.employeeId} style={{ borderBottom: '1px solid var(--sos-divider)', transition: 'background 140ms' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover, var(--sos-surface-2))')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarGradient(r.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                              {initials(fn ?? '', rest.join(' '))}
                            </div>
                            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</span>
                          </div>
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.branch ?? '—'}</td>
                        <td style={{ ...td, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{r.loginEmail ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {r.mailbox ?? <span style={{ color: 'var(--sos-text-muted)' }}>{r.suggestion ? `→ ${r.suggestion}` : '—'}</span>}
                        </td>
                        <td style={td}><StatusPill tone={s.tone}>{s.label}</StatusPill></td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {can('hr.onboard') && data.configured ? (
                            r.status === 'missing' ? (
                              <button className="sos-btn sos-btn--sm" onClick={() => setTarget(r)} style={{ gap: 6 }}><Wand2 size={14} /> Create</button>
                            ) : r.status === 'unlinked' ? (
                              <button className="sos-btn sos-btn--sm" onClick={() => setTarget(r)} style={{ gap: 6 }}><KeyRound size={14} /> Activate</button>
                            ) : (
                              <button className="sos-icon-btn" title="Reset password" onClick={() => setTarget(r)}><KeyRound size={15} /></button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </GlassCard>

      {target ? <ProvisionModal row={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); void load(); }} /> : null}
    </div>
  );
}

function ProvisionModal({ row, onClose, onDone }: { row: EmailAccountRow; onClose: () => void; onDone: () => void }) {
  const alreadyLogin = row.status === 'linked';
  const [setAsLogin, setSetAsLogin] = useState(row.status !== 'linked');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const verb = row.status === 'missing' ? 'Create mailbox' : row.status === 'unlinked' ? 'Activate mailbox' : 'Reset password';
  const run = async () => {
    setBusy(true); setError(null);
    try { setResult(await provisionMailbox(row.employeeId, setAsLogin && !alreadyLogin)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setBusy(false); }
  };
  return (
    <ModalShell title={result ? 'Done' : `${verb} · ${row.name}`} onClose={result ? onDone : onClose}>
      {result ? (
        <CredentialCard
          title={`${row.name} · ${result.action === 'created' ? 'mailbox created' : 'password reset'}${result.loginUpdated ? ' · login updated' : ''}`}
          email={result.email} password={result.password}
          note="Hand this to the employee. Same password works for the mailbox and (if set) the CRM login."
          onDone={onDone} />
      ) : (
        <div className="sos-stack" style={{ gap: 14 }}>
          <p style={{ fontSize: 14, color: 'var(--sos-text-secondary)' }}>
            {row.status === 'missing' && <>Create <strong style={{ color: 'var(--sos-text-primary)' }}>{row.suggestion}</strong> on MXRoute with a fresh password.</>}
            {row.status === 'unlinked' && <>The mailbox <strong style={{ color: 'var(--sos-text-primary)' }}>{row.mailbox}</strong> exists but they log in with <code>{row.loginEmail}</code>. This resets its password so you can hand it over.</>}
            {row.status === 'linked' && <>Reset the password for <strong style={{ color: 'var(--sos-text-primary)' }}>{row.mailbox}</strong>.</>}
          </p>
          {!alreadyLogin ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={setAsLogin} onChange={(e) => setSetAsLogin(e.target.checked)} />
              Also make this their <strong>CRM login</strong> email
            </label>
          ) : null}
          {error ? <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
            <PrimaryButton onClick={run} disabled={busy} iconLeft={busy ? <Loader2 size={16} className="sos-spin" /> : <Mail size={16} />}>
              {busy ? 'Working…' : verb}
            </PrimaryButton>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
