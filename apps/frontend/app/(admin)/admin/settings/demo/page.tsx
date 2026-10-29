'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createDemoLink,
  getDemoStatus,
  listDemoLinks,
  revokeDemoLink,
  runDemoLeakCheck,
  runDemoSync,
  type DemoAccessLink,
  type DemoStatus,
} from '@/lib/demo-admin';
import { useRuntimeConfig } from '@/lib/runtime-config';

/**
 * Admin → Sales Demo. Only meaningful on the demo deployment: create / revoke
 * prospect sign-in links (with a usage trail), trigger a sync, run the leak
 * check. Reachable at /admin/settings/demo (not in the sidebar on purpose).
 */
export default function DemoAdminPage() {
  const cfg = useRuntimeConfig();
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [links, setLinks] = useState<DemoAccessLink[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DemoAccessLink | null>(null);
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('admin');
  const [hours, setHours] = useState(48);

  const reload = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([getDemoStatus(), listDemoLinks()]);
      setStatus(s);
      setLinks(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const card: React.CSSProperties = {
    background: 'var(--sos-surface)',
    border: '1px solid var(--sos-border)',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  };
  const btn = (primary = false): React.CSSProperties => ({
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--sos-border)',
    background: primary ? 'var(--sos-accent, #4f46e5)' : 'transparent',
    color: primary ? '#fff' : 'var(--sos-text-primary)',
  });

  if (!cfg.demoMode) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Sales Demo</h1>
        <p style={{ color: 'var(--sos-text-muted)' }}>This deployment is not running in DEMO_MODE, so there is nothing to manage here.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1080 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Sales Demo</h1>
      <p style={{ color: 'var(--sos-text-muted)', marginTop: 0 }}>
        Prospect sign-in links, production → demo sync and the leak check.
      </p>
      {error ? (
        <div style={{ ...card, borderColor: '#f87171', color: '#991b1b' }}>{error}</div>
      ) : null}

      <section style={card}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>New prospect link</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, flex: '1 1 260px' }}>
            Label (company / person / call date)
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Acme Immigration — sales call 3 Nov" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--sos-border)' }} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Signs in as
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'agent')} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--sos-border)' }}>
              <option value="admin">Demo admin (everything)</option>
              <option value="agent">Demo sales agent (inbox)</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            Valid for (hours)
            <input type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value) || 48)} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--sos-border)', width: 100 }} />
          </label>
          <button
            type="button"
            style={btn(true)}
            disabled={busy === 'create' || label.trim().length < 2}
            onClick={() =>
              act('create', async () => {
                const l = await createDemoLink({ label: label.trim(), role, hours });
                setCreated(l);
                setLabel('');
              })
            }
          >
            {busy === 'create' ? 'Creating…' : 'Create link'}
          </button>
        </div>
        {created?.url ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--sos-status-success-soft, #ecfdf5)', fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Link for “{created.label}” — copy it now, it is shown once:</div>
            <code style={{ wordBreak: 'break-all' }}>{created.url}</code>
            <div style={{ marginTop: 6 }}>
              <button type="button" style={btn()} onClick={() => navigator.clipboard?.writeText(created.url!)}>
                Copy
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Links</h2>
        {links.length === 0 ? (
          <p style={{ color: 'var(--sos-text-muted)', fontSize: 13 }}>No links yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)' }}>
                <th style={{ padding: 6 }}>Label</th>
                <th style={{ padding: 6 }}>Role</th>
                <th style={{ padding: 6 }}>Expires</th>
                <th style={{ padding: 6 }}>Uses</th>
                <th style={{ padding: 6 }}>Last used</th>
                <th style={{ padding: 6 }}>Status</th>
                <th style={{ padding: 6 }} />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                  <td style={{ padding: 6 }}>
                    {l.label} <span style={{ color: 'var(--sos-text-faint)' }}>…{l.tokenTail}</span>
                    {l.uses?.length ? (
                      <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                        {l.uses.slice(0, 3).map((u) => (
                          <div key={u.id}>
                            {new Date(u.usedAt).toLocaleString()} · {u.ipAddress ?? '?'} · {(u.userAgent ?? '').replace(/^demo-link:\S+\s*/, '').slice(0, 60)}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: 6 }}>{l.role}</td>
                  <td style={{ padding: 6 }}>{new Date(l.expiresAt).toLocaleString()}</td>
                  <td style={{ padding: 6 }}>{l.useCount}{l.maxUses ? ` / ${l.maxUses}` : ''}</td>
                  <td style={{ padding: 6 }}>{l.lastUsedAt ? new Date(l.lastUsedAt).toLocaleString() : '—'}</td>
                  <td style={{ padding: 6 }}>{l.revokedAt ? 'revoked' : l.active ? 'active' : 'expired'}</td>
                  <td style={{ padding: 6 }}>
                    {!l.revokedAt ? (
                      <button type="button" style={btn()} disabled={busy === l.id} onClick={() => act(l.id, () => revokeDemoLink(l.id))}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Sync &amp; leak check</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" style={btn(true)} disabled={busy === 'sync'} onClick={() => act('sync', () => runDemoSync(false))}>
            {busy === 'sync' ? 'Syncing…' : 'Sync now (incremental)'}
          </button>
          <button type="button" style={btn()} disabled={busy === 'full'} onClick={() => act('full', () => runDemoSync(true))}>
            {busy === 'full' ? 'Resetting…' : 'Full sync / reset demo data'}
          </button>
          <button type="button" style={btn()} disabled={busy === 'leak'} onClick={() => act('leak', () => runDemoLeakCheck())}>
            {busy === 'leak' ? 'Scanning…' : 'Run leak check'}
          </button>
          <button type="button" style={btn()} onClick={() => void reload()}>
            Refresh
          </button>
        </div>
        {status ? (
          <div style={{ fontSize: 13, display: 'grid', gap: 6 }}>
            <div>
              Sync timer: <strong>{status.syncEnabled ? 'on' : 'off'}</strong> · configured: <strong>{status.configured ? 'yes' : 'no'}</strong> · running now: <strong>{status.running ? 'yes' : 'no'}</strong>
            </div>
            {status.lastResult ? (
              <div>
                Last run {status.lastResult.full ? '(full)' : '(incremental)'} finished {new Date(status.lastResult.finishedAt).toLocaleString()} —{' '}
                <strong style={{ color: status.lastResult.ok ? 'var(--sos-status-success, #15803d)' : '#b91c1c' }}>{status.lastResult.ok ? 'ok' : 'errors'}</strong>
                {' · '}
                {status.lastResult.tables.reduce((a, t) => a + t.written, 0)} rows written,{' '}
                {status.lastResult.tables.reduce((a, t) => a + t.pruned, 0)} pruned
                {status.lastResult.tables.filter((t) => t.error).map((t) => (
                  <div key={t.table} style={{ color: '#b91c1c' }}>
                    {t.table}: {t.error}
                  </div>
                ))}
              </div>
            ) : null}
            {status.lastLeakCheck ? (
              <div>
                Leak check:{' '}
                <strong style={{ color: status.lastLeakCheck.ok ? 'var(--sos-status-success, #15803d)' : '#b91c1c' }}>
                  {status.lastLeakCheck.ok ? 'PASSED' : `FAILED (${status.lastLeakCheck.findings.length} findings)`}
                </strong>{' '}
                · {status.lastLeakCheck.scannedTables} tables / {status.lastLeakCheck.scannedRows} rows in {status.lastLeakCheck.ms} ms
                {status.lastLeakCheck.findings.slice(0, 20).map((f, i) => (
                  <div key={i} style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12 }}>
                    {f.kind} {f.table}.{f.column} pk={f.pk} match={f.match}
                  </div>
                ))}
              </div>
            ) : null}
            {status.recentRuns.length ? (
              <details>
                <summary style={{ cursor: 'pointer' }}>Recent runs ({status.recentRuns.length})</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {status.recentRuns.map((r) => (
                    <li key={r.id}>
                      {new Date(r.startedAt).toLocaleString()} — {r.isFull ? 'full' : 'incremental'} — {r.ok ? 'ok' : 'errors'}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
