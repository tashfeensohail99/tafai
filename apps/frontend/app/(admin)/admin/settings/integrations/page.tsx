'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Key,
  MessageSquare,
  RefreshCw,
  Save,
  Webhook,
} from 'lucide-react';
import {
  EmptyState,
  Field,
  FormInput,
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  connectChannel,
  listChannels,
  type AdminChannel,
} from '@/lib/whatsapp-admin';

// ─── helpers ────────────────────────────────────────────────────────────────

function mask(s: string): string {
  if (!s) return '';
  if (s.length <= 12) return '••••••••';
  return s.slice(0, 6) + '••••••••••••' + s.slice(-4);
}

function copyToClipboard(text: string, onDone: () => void) {
  void navigator.clipboard.writeText(text).then(() => {
    onDone();
    setTimeout(onDone, 2000);
  });
}

// ─── RevealField — masked text with show/hide toggle ────────────────────────

function RevealField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div
          className="sos-input"
          style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: 13,
            letterSpacing: show ? 'normal' : '0.12em',
            color: 'var(--sos-text-secondary)',
            cursor: 'default',
            userSelect: show ? 'text' : 'none',
          }}
        >
          {show ? value : mask(value)}
        </div>
        <GhostButton
          size="sm"
          title={show ? 'Hide' : 'Reveal'}
          onClick={() => setShow((v) => !v)}
          iconLeft={show ? <EyeOff size={13} /> : <Eye size={13} />}
        />
        <GhostButton
          size="sm"
          title="Copy"
          onClick={() => copyToClipboard(value, () => setCopied(true))}
          iconLeft={copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
        />
      </div>
    </Field>
  );
}

// ─── EnvVarNote ─────────────────────────────────────────────────────────────

function EnvVarNote({ vars }: { vars: string[] }) {
  return (
    <div
      className="sos-banner sos-banner--info"
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 }}
    >
      <Key size={14} style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 12.5 }}>
        These values are read from server environment variables (
        {vars.map((v, i) => (
          <span key={v}>
            <code style={{ fontSize: 11.5 }}>{v}</code>
            {i < vars.length - 1 ? ', ' : ''}
          </span>
        ))}
        ). Set them in Railway → Variables to update them. They are never stored in the database.
      </span>
    </div>
  );
}

// ─── ConnectedChannelCard ────────────────────────────────────────────────────

function ConnectedChannelCard({
  channel,
  onEdit,
}: {
  channel: AdminChannel;
  onEdit: () => void;
}) {
  const tone = channel.status === 'ACTIVE' ? 'success' : channel.status === 'PAUSED' ? 'warning' : 'danger';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-brand-primary-soft)',
          color: 'var(--sos-brand-primary)',
          border: '1px solid var(--sos-brand-primary-border)',
          flexShrink: 0,
        }}
      >
        <MessageSquare size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
            {channel.label}
          </span>
          <StatusBadge tone={tone} size="sm" dot>
            {channel.status.toLowerCase()}
          </StatusBadge>
        </div>
        <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)', marginTop: 2 }}>
          {channel.displayNumber} · phone_number_id {channel.phoneNumberId}
        </div>
      </div>
      <GhostButton size="sm" onClick={onEdit}>
        Update credentials
      </GhostButton>
    </div>
  );
}

// ─── ChannelForm ─────────────────────────────────────────────────────────────

interface ChannelFormProps {
  initial?: AdminChannel;
  onSaved: () => void;
  onCancel?: () => void;
}

function ChannelForm({ initial, onSaved, onCancel }: ChannelFormProps) {
  const [label, setLabel] = useState(initial?.label ?? 'Tashfeen Main');
  const [wabaId, setWabaId] = useState(initial?.wabaId ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(initial?.phoneNumberId ?? '');
  const [displayNumber, setDisplayNumber] = useState(initial?.displayNumber ?? '');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (!label.trim() || !wabaId.trim() || !phoneNumberId.trim() || !displayNumber.trim() || !accessToken.trim()) {
      setError('All fields are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await connectChannel({ label, wabaId, phoneNumberId, displayNumber, accessToken });
      setSuccess(true);
      setAccessToken('');
      setTimeout(() => {
        setSuccess(false);
        onSaved();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {initial ? (
        <div
          className="sos-banner sos-banner--info"
          style={{ fontSize: 12.5 }}
        >
          You are updating credentials for <strong>{initial.displayNumber}</strong>. The access token
          field must be filled — leave other fields as-is if unchanged.
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        <Field label="Channel label" hint="A short display name shown in the CRM">
          <FormInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Tashfeen Main"
          />
        </Field>

        <Field
          label="WABA ID (WhatsApp Business Account ID)"
          hint="Found in Meta Business Manager → WhatsApp Accounts"
        >
          <FormInput
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder="e.g. 123456789012345"
            style={{ fontFamily: 'monospace' }}
          />
        </Field>

        <Field
          label="Phone Number ID"
          hint="From Meta Developer App → WhatsApp → API Setup"
        >
          <FormInput
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder="e.g. 972835392581526"
            style={{ fontFamily: 'monospace' }}
          />
        </Field>

        <Field label="Display phone number" hint="The number shown to customers, e.g. +92 312 5569101">
          <FormInput
            value={displayNumber}
            onChange={(e) => setDisplayNumber(e.target.value)}
            placeholder="+92 312 5569101"
          />
        </Field>
      </div>

      <Field
        label="Permanent access token"
        hint={
          initial
            ? 'Enter the new token. Leave blank to keep the existing encrypted token — but you must still provide a value here to submit.'
            : 'Your Meta permanent system user access token. Encrypted with AES-256-GCM before storage.'
        }
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type={showToken ? 'text' : 'password'}
              className="sos-input"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxxxxxxxxxxxx"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, paddingRight: 36 }}
              autoComplete="new-password"
            />
          </div>
          <GhostButton
            size="sm"
            title={showToken ? 'Hide token' : 'Show token'}
            onClick={() => setShowToken((v) => !v)}
            iconLeft={showToken ? <EyeOff size={13} /> : <Eye size={13} />}
          />
        </div>
      </Field>

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', gap: 8 }}>
          <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Credentials saved successfully.</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {onCancel ? (
          <GhostButton size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </GhostButton>
        ) : null}
        <PrimaryButton
          iconLeft={submitting ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? 'Saving…' : 'Save channel'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── WebhookSection ──────────────────────────────────────────────────────────

function WebhookSection() {
  const [copied, setCopied] = useState(false);
  const webhookUrl = 'https://backend-production-5a89.up.railway.app/v1/whatsapp/webhooks/meta';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="sos-eyebrow" style={{ marginBottom: 6 }}>
          Webhook callback URL
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div
            className="sos-input"
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 12.5,
              color: 'var(--sos-text-secondary)',
              cursor: 'default',
              userSelect: 'text',
            }}
          >
            {webhookUrl}
          </div>
          <GhostButton
            size="sm"
            iconLeft={copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            onClick={() => copyToClipboard(webhookUrl, () => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy'}
          </GhostButton>
        </div>
        <div className="sos-text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          Paste this into Meta → App Dashboard → WhatsApp → Configuration → Webhook URL.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        <EnvTile
          label="Verify token"
          envVar="META_WEBHOOK_VERIFY_TOKEN"
          hint="Must match what you enter in Meta webhook config."
        />
        <EnvTile
          label="App secret"
          envVar="META_APP_SECRET"
          hint="Used to verify the X-Hub-Signature-256 on every webhook event."
        />
        <EnvTile
          label="Token encryption key"
          envVar="WHATSAPP_ENCRYPTION_KEY"
          hint="64-hex-char AES-256-GCM key. Used to encrypt stored access tokens."
        />
      </div>

      <EnvVarNote vars={['META_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET', 'WHATSAPP_ENCRYPTION_KEY']} />
    </div>
  );
}

function EnvTile({ label, envVar, hint }: { label: string; envVar: string; hint: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div className="sos-eyebrow" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <code style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', display: 'block', marginBottom: 6 }}>
        {envVar}
      </code>
      <div className="sos-text-muted" style={{ fontSize: 12 }}>
        {hint}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function IntegrationsSettingsPage() {
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<AdminChannel | null | 'new'>('new');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listChannels();
      setChannels(list);
      if (list.length > 0) setEditingChannel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeChannel = channels[0] ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Settings · Integrations"
        title="External API credentials"
        description="Connect Tashfeen to WhatsApp Business Cloud API. Credentials are encrypted at rest and never returned to the client after saving."
        actions={
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
            Refresh
          </GhostButton>
        }
      />

      {/* ── WhatsApp channel ──────────────────────────────────────────────── */}
      <GlassCard variant="default" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
              <MessageSquare size={16} />
            </div>
            <div>
              <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
                WhatsApp Business Cloud API
              </div>
              <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
                Meta phone number, WABA ID, and access token
              </div>
            </div>
          </div>

          {loading ? (
            <div className="sos-text-muted" style={{ fontSize: 13 }}>Loading…</div>
          ) : error ? (
            <div className="sos-banner sos-banner--danger">{error}</div>
          ) : activeChannel && editingChannel === null ? (
            <ConnectedChannelCard
              channel={activeChannel}
              onEdit={() => setEditingChannel(activeChannel)}
            />
          ) : editingChannel === 'new' || editingChannel === null ? (
            <ChannelForm onSaved={() => void reload()} />
          ) : (
            <ChannelForm
              initial={editingChannel}
              onSaved={() => {
                setEditingChannel(null);
                void reload();
              }}
              onCancel={() => setEditingChannel(null)}
            />
          )}
        </div>
      </GlassCard>

      {/* ── Webhook & security ────────────────────────────────────────────── */}
      <GlassCard variant="default" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--sos-surface-2)',
                color: 'var(--sos-text-secondary)',
              }}
            >
              <Webhook size={16} />
            </div>
            <div>
              <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
                Webhook & security
              </div>
              <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
                Configure in Meta App Dashboard — read from server env vars
              </div>
            </div>
          </div>

          <WebhookSection />
        </div>
      </GlassCard>

      {/* ── Quick-ref: credential summary ────────────────────────────────── */}
      {activeChannel ? (
        <GlassCard variant="soft" padded="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="sos-eyebrow">Currently connected — read-only summary</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              <SummaryTile label="Channel label" value={activeChannel.label} />
              <SummaryTile label="Display number" value={activeChannel.displayNumber} />
              <SummaryTile label="Phone number ID" value={activeChannel.phoneNumberId} mono />
              <SummaryTile label="WABA ID" value={activeChannel.wabaId} mono />
              <SummaryTile
                label="Status"
                value={activeChannel.status}
                badge={
                  activeChannel.status === 'ACTIVE'
                    ? 'success'
                    : activeChannel.status === 'PAUSED'
                      ? 'warning'
                      : 'danger'
                }
              />
              <SummaryTile
                label="Access token"
                value="Encrypted — not returned after save"
                muted
              />
            </div>
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  mono,
  muted,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  badge?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-0)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div className="sos-eyebrow" style={{ marginBottom: 4 }}>
        {label}
      </div>
      {badge ? (
        <StatusBadge tone={badge} size="sm">
          {value.toLowerCase()}
        </StatusBadge>
      ) : (
        <div
          style={{
            fontSize: muted ? 12 : 13,
            fontFamily: mono ? 'monospace' : undefined,
            color: muted ? 'var(--sos-text-faint)' : 'var(--sos-text-primary)',
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}
