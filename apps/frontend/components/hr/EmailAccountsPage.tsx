'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, MailCheck, MailWarning, MailX, Loader2, KeyRound, Wand2 } from 'lucide-react';
import { PageHeader, GlassCard, MetricCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/sales-v2/ui';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useHrSession } from '../layout/HrShell';
import { CredentialCard, ModalShell } from './HrDirectory';
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

  const load = useCallback(async () => {
    try { setErr(null); setData(await getEmailAccounts()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);

  useEffect(() => { if (can('hr.view')) void load(); /* eslint-disable-next-line */ }, []);
  if (!can('hr.view')) return <PermissionDeniedState />;

  return (
    <div className="sos-stack" style={{ gap: 20 }}>
      <PageHeader eyebrow="Human Resources" title="Email Accounts"
        description={`Business email status across the team${data ? ` · @${data.domain}` : ''}. Create missing mailboxes or activate dormant ones.`} />

      {!data?.configured && data ? (
        <GlassCard><div style={{ padding: 12, opacity: 0.7 }}>MXRoute isn’t configured — provisioning is disabled.</div></GlassCard>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <MetricCard label="Active business email" value={String(data?.counts.linked ?? '—')} Icon={MailCheck} />
        <MetricCard label="Mailbox unused" value={String(data?.counts.unlinked ?? '—')} Icon={MailWarning} tone="warning" />
        <MetricCard label="No email" value={String(data?.counts.missing ?? '—')} Icon={MailX} tone="danger" />
      </div>

      <GlassCard>
        {err ? <ErrorState message={err} onRetry={load} />
          : !data ? <LoadingState />
          : (
            <div style={{ overflowX: 'auto' }}>
              <table className="sos-table" style={{ width: '100%', minWidth: 820 }}>
                <thead><tr>
                  <th>Name</th><th>Branch</th><th>CRM login</th><th>Business mailbox</th><th>Status</th><th></th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => {
                    const s = STATUS[r.status];
                    return (
                      <tr key={r.employeeId}>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td>{r.branch ?? '—'}</td>
                        <td style={{ opacity: 0.8 }}>{r.loginEmail ?? '—'}</td>
                        <td>{r.mailbox ?? <span style={{ opacity: 0.5 }}>{r.suggestion ? `→ ${r.suggestion}` : '—'}</span>}</td>
                        <td><StatusBadge tone={s.tone}>{s.label}</StatusBadge></td>
                        <td style={{ textAlign: 'right' }}>
                          {can('hr.onboard') && data.configured ? (
                            r.status === 'missing' ? (
                              <button className="sos-btn sos-btn--sm" onClick={() => setTarget(r)}><Wand2 size={14} /> Create email</button>
                            ) : r.status === 'unlinked' ? (
                              <button className="sos-btn sos-btn--sm" onClick={() => setTarget(r)}><KeyRound size={14} /> Activate</button>
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
          onDone={onDone}
        />
      ) : (
        <div className="sos-stack" style={{ gap: 14 }}>
          <p style={{ fontSize: 14, opacity: 0.85 }}>
            {row.status === 'missing' && <>Create <strong>{row.suggestion}</strong> on MXRoute with a fresh password.</>}
            {row.status === 'unlinked' && <>The mailbox <strong>{row.mailbox}</strong> already exists but they log in with <code>{row.loginEmail}</code>. This resets its password so you can hand it over.</>}
            {row.status === 'linked' && <>Reset the password for <strong>{row.mailbox}</strong>.</>}
          </p>
          {!alreadyLogin ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={setAsLogin} onChange={(e) => setSetAsLogin(e.target.checked)} />
              Also make this their <strong>CRM login</strong> email
            </label>
          ) : null}
          {error ? <div style={{ color: 'var(--sos-danger, #e5484d)', fontSize: 13 }}>{error}</div> : null}
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
