'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, MailCheck, MailWarning, MailX, Loader2, KeyRound, Wand2 } from 'lucide-react';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useHrSession } from '../layout/HrShell';
import { CredentialCard } from './HrDirectory';
import { Avatar, Pill, Modal } from './ui';
import { getEmailAccounts, provisionMailbox, type EmailAccountsResult, type EmailAccountRow, type ProvisionResult } from '@/lib/hr';

const STATUS: Record<EmailAccountRow['status'], { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  linked: { label: 'Active email', tone: 'ok' },
  unlinked: { label: 'Mailbox unused', tone: 'warn' },
  missing: { label: 'No email', tone: 'bad' },
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
  const total = data ? data.counts.linked + data.counts.unlinked + data.counts.missing : 0;
  const pct = total ? Math.round((data!.counts.linked / total) * 100) : 0;
  const w = (n: number) => (total ? `${(n / total) * 100}%` : '0%');

  return (
    <div className="hr-console">
      <div className="hr-head">
        <div>
          <div className="hr-eyebrow">Human Resources</div>
          <h1 className="hr-h1">Email Accounts</h1>
          <div className="hr-lede">Business email status across the team{data ? ` · @${data.domain}` : ''}. Create missing mailboxes or activate dormant ones.</div>
        </div>
      </div>

      {data && !data.configured ? (
        <div className="hr-panel"><div style={{ padding: 16, color: 'var(--hr-muted)' }}>MXRoute isn’t configured — provisioning is disabled.</div></div>
      ) : null}

      {data ? (
        <div className="hr-coverage">
          <div className="hr-coverage__top">
            <div>
              <div className="hr-coverage__k">Business-email coverage</div>
              <div className="hr-coverage__pct">{pct}%<small>fully set · {data.counts.linked} of {total}</small></div>
            </div>
            <div style={{ textAlign: 'right', color: 'var(--hr-text-2)', fontSize: 13, fontWeight: 600 }}>
              {data.counts.unlinked + data.counts.missing} need action
              <br /><span style={{ color: 'var(--hr-muted)', fontWeight: 500 }}>{data.counts.unlinked} dormant · {data.counts.missing} missing</span>
            </div>
          </div>
          <div className="hr-cbar">
            <span style={{ width: w(data.counts.linked), background: 'var(--hr-ok)' }} />
            <span style={{ width: w(data.counts.unlinked), background: 'var(--hr-warn)' }} />
            <span style={{ width: w(data.counts.missing), background: 'var(--hr-bad)' }} />
          </div>
          <div className="hr-cleg">
            <div><i style={{ background: 'var(--hr-ok)' }} />{data.counts.linked} active email</div>
            <div><i style={{ background: 'var(--hr-warn)' }} />{data.counts.unlinked} mailbox unused</div>
            <div><i style={{ background: 'var(--hr-bad)' }} />{data.counts.missing} no email</div>
          </div>
        </div>
      ) : null}

      <div className="hr-stats">
        <FilterStat ico="ok" Icon={MailCheck} value={data?.counts.linked ?? 0} label="Active business email" hint="Login is their @domain email"
          sel={filter === null} onClick={() => setFilter(null)} />
        <FilterStat ico="warn" Icon={MailWarning} value={data?.counts.unlinked ?? 0} label="Mailbox unused" hint="Exists but not their login"
          sel={filter === 'unlinked'} onClick={() => setFilter((f) => (f === 'unlinked' ? null : 'unlinked'))} />
        <FilterStat ico="bad" Icon={MailX} value={data?.counts.missing ?? 0} label="No email" hint="Needs a mailbox"
          sel={filter === 'missing'} onClick={() => setFilter((f) => (f === 'missing' ? null : 'missing'))} />
      </div>

      <div className="hr-panel">
        <div className="hr-panel__head">
          <div className="hr-panel__title">{filter ? STATUS[filter].label : 'All staff'} <span>{shown.length}</span></div>
          {filter ? <button className="hr-clear" onClick={() => setFilter(null)}>Show all</button> : null}
        </div>

        {err ? <div style={{ padding: 20 }}><ErrorState message={err} onRetry={load} /></div>
          : !data ? <div style={{ padding: 20 }}><LoadingState /></div>
          : (
            <div className="hr-tbl-wrap">
              <table className="hr-table">
                <thead><tr>{['Employee', 'Branch', 'CRM login', 'Business mailbox', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const s = STATUS[r.status];
                    return (
                      <tr key={r.employeeId}>
                        <td><div className="hr-who"><Avatar name={r.name} size={34} /><b>{r.name}</b></div></td>
                        <td className="hr-cell-strong">{r.branch ?? '—'}</td>
                        <td className="hr-dim" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.loginEmail ?? '—'}</td>
                        <td className="hr-mono" style={{ fontSize: 12.5 }}>{r.mailbox ?? <span className="hr-dim">{r.suggestion ? `→ ${r.suggestion}` : '—'}</span>}</td>
                        <td><Pill tone={s.tone}>{s.label}</Pill></td>
                        <td style={{ textAlign: 'right' }}>
                          {can('hr.onboard') && data.configured ? (
                            r.status === 'missing' ? <button className="hr-rowbtn hr-rowbtn--go" onClick={() => setTarget(r)}><Wand2 size={14} /> Create</button>
                              : r.status === 'unlinked' ? <button className="hr-rowbtn hr-rowbtn--go" onClick={() => setTarget(r)}><KeyRound size={14} /> Activate</button>
                              : <button className="hr-iconbtn" title="Reset password" onClick={() => setTarget(r)}><KeyRound size={15} /></button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {target ? <ProvisionModal row={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); void load(); }} /> : null}
    </div>
  );
}

function FilterStat({ ico, Icon, value, label, hint, sel, onClick }: {
  ico: string; Icon: React.ComponentType<{ size?: number }>; value: number | string; label: string; hint: string; sel: boolean; onClick: () => void;
}) {
  return (
    <div className={`hr-stat hr-stat--click${sel ? ' hr-stat--sel' : ''}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className={`hr-stat__ico hr-i-${ico}`}><Icon size={17} /></div>
      <div className="hr-stat__v">{value}</div>
      <div className="hr-stat__l">{label}</div>
      <div className="hr-stat__h">{hint}</div>
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
    <Modal title={result ? 'Done' : `${verb} · ${row.name}`} onClose={result ? onDone : onClose}>
      {result ? (
        <CredentialCard
          title={`${row.name} · ${result.action === 'created' ? 'mailbox created' : 'password reset'}${result.loginUpdated ? ' · login updated' : ''}`}
          email={result.email} password={result.password}
          note="Hand this to the employee. Same password works for the mailbox and (if set) the CRM login." onDone={onDone} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 14, color: 'var(--hr-text-2)', margin: 0 }}>
            {row.status === 'missing' && <>Create <strong style={{ color: 'var(--hr-text)' }}>{row.suggestion}</strong> on MXRoute with a fresh password.</>}
            {row.status === 'unlinked' && <>The mailbox <strong style={{ color: 'var(--hr-text)' }}>{row.mailbox}</strong> exists but they log in with <code style={{ color: 'var(--hr-text)' }}>{row.loginEmail}</code>. This resets its password so you can hand it over.</>}
            {row.status === 'linked' && <>Reset the password for <strong style={{ color: 'var(--hr-text)' }}>{row.mailbox}</strong>.</>}
          </p>
          {!alreadyLogin ? (
            <label className="hr-check"><input type="checkbox" checked={setAsLogin} onChange={(e) => setSetAsLogin(e.target.checked)} /> Also make this their <strong>CRM login</strong> email</label>
          ) : null}
          {error ? <div style={{ color: 'var(--hr-bad)', fontSize: 13 }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="hr-btn hr-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="hr-btn hr-btn--primary" onClick={run} disabled={busy}>{busy ? <Loader2 size={16} className="hr-spin" /> : <Mail size={16} />} {busy ? 'Working…' : verb}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
