'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Key, Loader2, Plus, RefreshCw, Save, Signal, Trash2 } from 'lucide-react';
import {
  Field,
  FormInput,
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  deleteApiKey,
  listApiKeys,
  setApiKeyActive,
  testApiKey,
  upsertApiKey,
  type AdminApiKey,
} from '@/lib/api-keys';

/**
 * Admin → API Keys. Single source of truth for third-party secrets (OpenAI
 * etc.). Plaintext keys are accepted ONCE and immediately encrypted at rest
 * (AES-256-GCM); the API never returns the secret again — only a "…AbCd"
 * tail preview and last-test status.
 *
 * Changing the active key here propagates to every consumer (AI orchestrator,
 * future providers) within ~30 seconds via the backend's in-memory cache.
 */

const PROVIDERS: Array<{ key: string; label: string; hint: string }> = [
  {
    key: 'openai',
    label: 'OpenAI',
    hint:
      'Used by the WhatsApp AI bot for gpt-4o-mini compose + text-embedding-3-small knowledge search. Get one at platform.openai.com/api-keys.',
  },
];

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'Never';
}

export default function ApiKeysPage() {
  const [rows, setRows] = useState<AdminApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listApiKeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleTest = async (id: string) => {
    setBusy(`test:${id}`);
    setNotice(null);
    setError(null);
    try {
      const res = await testApiKey(id);
      if (res.ok) setNotice('Key tested successfully against the provider.');
      else setError(res.error ?? 'Provider rejected the key.');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not test key');
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    setBusy(`toggle:${id}`);
    setError(null);
    try {
      await setApiKeyActive(id, !current);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change active state');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this key? Any feature using it will fall back to "no key" until you set a new one.')) return;
    setBusy(`del:${id}`);
    setError(null);
    try {
      await deleteApiKey(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete key');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Settings · Integrations"
        title="API Keys"
        description="Manage third-party API secrets (OpenAI for the WhatsApp AI bot, future providers). Plaintext is encrypted at rest and never returned to the browser. Changes propagate to every consumer within ~30 seconds — no redeploy needed."
        actions={
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
            Refresh
          </GhostButton>
        }
      />

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {error}
        </div>
      ) : null}
      {notice && !error ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CheckCircle2 size={14} /> {notice}
        </div>
      ) : null}

      {PROVIDERS.map((p) => {
        const providerRows = rows.filter((r) => r.provider === p.key);
        const activeRow = providerRows.find((r) => r.isActive);
        return (
          <GlassCard key={p.key} variant="default" padded="lg">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--sos-brand-primary-soft)',
                    color: 'var(--sos-brand-primary)',
                  }}
                >
                  <Key size={16} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>{p.label}</div>
                  <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>{p.hint}</div>
                </div>
                {activeRow ? (
                  <StatusBadge tone="success" size="sm" dot>active</StatusBadge>
                ) : (
                  <StatusBadge tone="warning" size="sm" dot>not set</StatusBadge>
                )}
              </div>

              {loading ? (
                <div className="sos-text-muted" style={{ fontSize: 13 }}>Loading…</div>
              ) : providerRows.length === 0 ? (
                <div className="sos-text-muted" style={{ fontSize: 13 }}>No key set for {p.label} yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {providerRows.map((row) => (
                    <KeyRow
                      key={row.id}
                      row={row}
                      busy={busy}
                      onTest={() => void handleTest(row.id)}
                      onToggle={() => void handleToggle(row.id, row.isActive)}
                      onDelete={() => void handleDelete(row.id)}
                    />
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <PrimaryButton
                  size="sm"
                  iconLeft={<Plus size={14} />}
                  onClick={() => setShowAdd(true)}
                >
                  {providerRows.length === 0 ? `Add ${p.label} key` : `Replace / add another`}
                </PrimaryButton>
              </div>
            </div>
          </GlassCard>
        );
      })}

      {showAdd ? (
        <AddKeyModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            setNotice('Key saved — encrypted at rest. Consumers will pick it up within 30 seconds.');
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

function KeyRow({
  row,
  busy,
  onTest,
  onToggle,
  onDelete,
}: {
  row: AdminApiKey;
  busy: string | null;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 14px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>{row.label}</strong>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--sos-text-faint)' }}>
            sk-…{row.keyTail}
          </span>
          {row.isActive ? (
            <StatusBadge tone="success" size="sm" dot={false}>active</StatusBadge>
          ) : (
            <StatusBadge tone="neutral" size="sm" dot={false}>inactive</StatusBadge>
          )}
          {row.lastTestOk === true ? (
            <StatusBadge tone="success" size="sm" dot={false}>last test ok</StatusBadge>
          ) : row.lastTestOk === false ? (
            <StatusBadge tone="danger" size="sm" dot={false}>last test failed</StatusBadge>
          ) : null}
        </div>
        <div className="sos-text-faint" style={{ fontSize: 11.5, marginTop: 4 }}>
          Last used: {fmtDate(row.lastUsedAt)} · Last tested: {fmtDate(row.lastTestedAt)}
        </div>
        {row.lastTestError ? (
          <div className="sos-text-muted" style={{ fontSize: 11.5, marginTop: 4, color: 'var(--sos-text-danger)' }}>
            ⚠ {row.lastTestError.slice(0, 200)}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <GhostButton
          size="sm"
          iconLeft={busy === `test:${row.id}` ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Signal size={13} />}
          onClick={onTest}
          disabled={busy !== null}
        >
          Test
        </GhostButton>
        <GhostButton
          size="sm"
          onClick={onToggle}
          disabled={busy !== null}
        >
          {row.isActive ? 'Deactivate' : 'Activate'}
        </GhostButton>
        <GhostButton
          size="sm"
          iconLeft={<Trash2 size={13} />}
          onClick={onDelete}
          disabled={busy !== null}
        >
          Delete
        </GhostButton>
      </div>
    </div>
  );
}

function AddKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState('openai');
  const [label, setLabel] = useState('Production OpenAI (gpt-4o-mini)');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!label.trim() || !key.trim()) {
      setError('Label and key are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await upsertApiKey({ provider, label: label.trim(), key: key.trim() });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save key');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--sos-surface-0)',
          borderRadius: 'var(--sos-radius-lg)',
          padding: 24,
          border: '1px solid var(--sos-border-subtle)',
        }}
      >
        <h2 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-lg)' }}>Add API Key</h2>
        <p className="sos-text-muted" style={{ fontSize: 13, marginTop: 6 }}>
          Pasting a key here replaces the current active key for the same provider. The key is encrypted with AES-256-GCM before storage — we never log or return it after this submit.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <Field label="Provider">
            <select
              className="sos-input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="openai">OpenAI</option>
            </select>
          </Field>

          <Field label="Label" hint="A name to remember this key by — e.g. 'Production OpenAI'">
            <FormInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Production OpenAI" />
          </Field>

          <Field label="API key" hint="Paste the full secret. Encrypted before storage; never returned after save.">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={showKey ? 'text' : 'password'}
                className="sos-input"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-..."
                style={{ flex: 1, fontFamily: 'monospace', fontSize: 12.5 }}
                autoComplete="new-password"
              />
              <GhostButton
                size="sm"
                title={showKey ? 'Hide' : 'Show'}
                onClick={() => setShowKey((v) => !v)}
                iconLeft={showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              >
                {showKey ? 'Hide' : 'Show'}
              </GhostButton>
            </div>
          </Field>

          {error ? (
            <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8 }}>
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <GhostButton size="sm" onClick={onClose} disabled={submitting}>Cancel</GhostButton>
            <PrimaryButton
              size="sm"
              iconLeft={submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              onClick={() => void handleSave()}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save key'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
