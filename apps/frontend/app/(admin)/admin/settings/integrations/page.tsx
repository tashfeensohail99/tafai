'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Key,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  ShieldCheck,
  Signal,
  Webhook,
} from 'lucide-react';
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
  connectChannel,
  getIntegrationInfo,
  listChannels,
  verifyChannel,
  type AdminChannel,
  type ChannelVerification,
  type IntegrationInfo,
} from '@/lib/whatsapp-admin';

// ─── helpers ────────────────────────────────────────────────────────────────

function copyToClipboard(text: string, onDone: () => void) {
  void navigator.clipboard.writeText(text).then(() => {
    onDone();
    setTimeout(onDone, 2000);
  });
}

function formatTier(t: string | null | undefined): string {
  if (!t) return '—';
  return t.replace('TIER_', '').replace('UNLIMITED', '∞').toLowerCase();
}

function qualityTone(q: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (q === 'GREEN') return 'success';
  if (q === 'YELLOW') return 'warning';
  if (q === 'RED') return 'danger';
  return 'neutral';
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

// ─── Verification result card ────────────────────────────────────────────────

function VerificationCard({ result }: { result: ChannelVerification }) {
  if (result.ok) {
    return (
      <div
        className="sos-banner sos-banner--success"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={14} />
          <strong style={{ fontSize: 13 }}>Live — Meta accepted the credentials</strong>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            fontSize: 12.5,
          }}
        >
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>Verified business name</div>
            <div style={{ fontWeight: 600 }}>{result.verifiedName ?? '—'}</div>
          </div>
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>Display number</div>
            <div style={{ fontFamily: 'monospace' }}>{result.displayPhoneNumber ?? '—'}</div>
          </div>
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>Quality rating</div>
            <StatusBadge tone={qualityTone(result.qualityRating)} size="sm" dot>
              {(result.qualityRating ?? 'unknown').toLowerCase()}
            </StatusBadge>
          </div>
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>Messaging tier</div>
            <div style={{ fontWeight: 600 }}>{formatTier(result.messagingLimitTier)}</div>
          </div>
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>Phone verification</div>
            <div>{result.codeVerificationStatus ?? '—'}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="sos-banner sos-banner--danger"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} />
        <strong style={{ fontSize: 13 }}>Meta rejected the credentials</strong>
      </div>
      <div style={{ fontSize: 12.5 }}>
        {result.error?.title ? <strong>{result.error.title}: </strong> : null}
        {result.error?.message ?? 'Unknown error from Meta Graph API.'}
        {result.error?.code ? (
          <span className="sos-text-muted" style={{ marginLeft: 6 }}>
            (code {result.error.code})
          </span>
        ) : null}
      </div>
      <div className="sos-text-muted" style={{ fontSize: 12 }}>
        Common causes: access token expired or revoked · wrong phone-number-id · token
        was issued for a different Meta app · app review not approved for this WABA.
      </div>
    </div>
  );
}

// ─── ConnectedChannelCard ────────────────────────────────────────────────────

function ConnectedChannelCard({
  channel,
  verification,
  onEdit,
  onTest,
  testing,
}: {
  channel: AdminChannel;
  verification: ChannelVerification | null;
  onEdit: () => void;
  onTest: () => void;
  testing: boolean;
}) {
  const tone = channel.status === 'ACTIVE' ? 'success' : channel.status === 'PAUSED' ? 'warning' : 'danger';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          borderRadius: 'var(--sos-radius-sm)',
          background: 'var(--sos-surface-1)',
          border: '1px solid var(--sos-border-subtle)',
          flexWrap: 'wrap',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
              {channel.label}
            </span>
            <StatusBadge tone={tone} size="sm" dot>
              {channel.status.toLowerCase()}
            </StatusBadge>
            {channel.lastSyncAt ? (
              <span className="sos-text-faint" style={{ fontSize: 11 }}>
                · last verified {new Date(channel.lastSyncAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)', marginTop: 2 }}>
            {channel.displayNumber} · phone_number_id <span style={{ fontFamily: 'monospace' }}>{channel.phoneNumberId}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton
            size="sm"
            disabled={testing}
            iconLeft={testing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Signal size={13} />}
            onClick={onTest}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </GhostButton>
          <GhostButton size="sm" onClick={onEdit}>
            Update credentials
          </GhostButton>
        </div>
      </div>
      {verification ? <VerificationCard result={verification} /> : null}
    </div>
  );
}

// ─── ChannelForm ─────────────────────────────────────────────────────────────

interface ChannelFormProps {
  initial?: AdminChannel;
  onSaved: (verification: ChannelVerification) => void;
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

  async function handleSubmit() {
    if (!label.trim() || !wabaId.trim() || !phoneNumberId.trim() || !displayNumber.trim() || !accessToken.trim()) {
      setError('All fields are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await connectChannel({ label, wabaId, phoneNumberId, displayNumber, accessToken });
      setAccessToken('');
      onSaved(res.verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {initial ? (
        <div className="sos-banner sos-banner--info" style={{ fontSize: 12.5 }}>
          You are updating credentials for <strong>{initial.displayNumber}</strong>. The access
          token field must be filled — leave other fields as-is if unchanged.
        </div>
      ) : (
        <div className="sos-banner sos-banner--info" style={{ fontSize: 12.5 }}>
          Paste these from <strong>Meta Business Manager → WhatsApp Manager → API Setup</strong>.
          Tashfeen will encrypt the access token (AES-256-GCM), save it, then immediately ping
          the Meta Graph API with it. If Meta accepts the call the integration goes live; if
          not we'll show you exactly what Meta returned.
        </div>
      )}

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
          hint="Meta Business Manager → WhatsApp Accounts → top of the page"
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
          hint="Meta Developer App → WhatsApp → API Setup → labelled phone_number_id"
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
            : 'Your Meta System User permanent access token. Encrypted with AES-256-GCM before storage; never returned over the wire after save.'
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
          >
            <span style={{ position: 'absolute', left: -9999 }}>
              {showToken ? 'Hide' : 'Show'}
            </span>
          </GhostButton>
        </div>
      </Field>

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
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
          {submitting ? 'Saving & verifying…' : 'Save & verify with Meta'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── WebhookSection ──────────────────────────────────────────────────────────

function WebhookSection({ info }: { info: IntegrationInfo | null }) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = info?.webhookUrl ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="sos-eyebrow" style={{ marginBottom: 6 }}>
          Webhook callback URL
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div
            className="sos-input"
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 12.5,
              color: webhookUrl ? 'var(--sos-text-secondary)' : 'var(--sos-text-faint)',
              cursor: 'default',
              userSelect: 'text',
            }}
          >
            {webhookUrl || 'Loading from server…'}
          </div>
          <GhostButton
            size="sm"
            disabled={!webhookUrl}
            iconLeft={copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            onClick={() => copyToClipboard(webhookUrl, () => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy'}
          </GhostButton>
        </div>
        <div className="sos-text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          Paste this into Meta → App Dashboard → WhatsApp → Configuration → Webhook URL. Subscribe
          to <code>messages</code>, <code>message_status</code>, and <code>message_template_status_update</code>.
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
          configured={info?.env.verifyTokenConfigured}
        />
        <EnvTile
          label="App secret"
          envVar="META_APP_SECRET"
          hint="Used to verify the X-Hub-Signature-256 on every webhook event."
          configured={info?.env.appSecretConfigured}
        />
        <EnvTile
          label="Token encryption key"
          envVar="WHATSAPP_ENCRYPTION_KEY"
          hint="64-hex-char AES-256-GCM key. Used to encrypt stored access tokens."
          configured={info?.env.encryptionKeyConfigured}
        />
        <EnvTile
          label="Graph API version pin"
          envVar="META_GRAPH_API_VERSION"
          hint={`Currently pinned to ${info?.apiVersion ?? '—'}. Bump when Meta deprecates.`}
          configured={Boolean(info?.apiVersion)}
        />
      </div>

      <EnvVarNote
        vars={['META_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET', 'WHATSAPP_ENCRYPTION_KEY', 'META_GRAPH_API_VERSION']}
      />
    </div>
  );
}

function EnvTile({
  label,
  envVar,
  hint,
  configured,
}: {
  label: string;
  envVar: string;
  hint: string;
  configured?: boolean;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="sos-eyebrow">{label}</div>
        {configured === undefined ? null : configured ? (
          <StatusBadge tone="success" size="sm" dot>set</StatusBadge>
        ) : (
          <StatusBadge tone="danger" size="sm" dot>missing</StatusBadge>
        )}
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
  const [info, setInfo] = useState<IntegrationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<AdminChannel | null | 'new'>('new');
  const [verification, setVerification] = useState<ChannelVerification | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, integrationInfo] = await Promise.all([
        listChannels(),
        getIntegrationInfo().catch(() => null),
      ]);
      setChannels(list);
      setInfo(integrationInfo);
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

  async function handleTest() {
    if (!activeChannel) return;
    setTesting(true);
    try {
      const result = await verifyChannel(activeChannel.id);
      setVerification(result);
      // Refresh channel list so the new lastSyncAt + tier flow through.
      const list = await listChannels();
      setChannels(list);
    } catch (err) {
      setVerification({
        ok: false,
        verifiedName: null,
        displayPhoneNumber: null,
        qualityRating: null,
        messagingLimitTier: null,
        codeVerificationStatus: null,
        platformType: null,
        error: { code: 0, message: err instanceof Error ? err.message : 'Failed to verify' },
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Settings · Integrations"
        title="Meta WhatsApp Cloud API"
        description="Paste your Meta WhatsApp credentials once. We encrypt the token, save it, and immediately verify with Meta's Graph API — so you know within seconds whether the integration is live."
        actions={
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
            Refresh
          </GhostButton>
        }
      />

      {/* ── Setup vs. day-to-day operations callout ─────────────────────── */}
      <div
        className="sos-banner sos-banner--info"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5 }}
      >
        <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          <strong>This page (Integrations)</strong> is for initial setup and credential rotation —
          everything Tashfeen needs to talk to Meta lives here.{' '}
          <strong>
            <Link
              href={'/admin/settings/whatsapp/channels' as Route}
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              WhatsApp → Channels
            </Link>
          </strong>{' '}
          is for day-to-day operations on the same connected numbers (pause / resume, re-sync
          approved templates, monitor tier). The two pages share the same backing channel rows;
          you don't need to set things up in both places.
        </span>
      </div>

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
                Meta phone number, WABA ID, and permanent access token
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
              verification={verification}
              onEdit={() => {
                setVerification(null);
                setEditingChannel(activeChannel);
              }}
              onTest={() => void handleTest()}
              testing={testing}
            />
          ) : editingChannel === 'new' || editingChannel === null ? (
            <ChannelForm
              onSaved={(v) => {
                setVerification(v);
                void reload();
              }}
            />
          ) : (
            <ChannelForm
              initial={editingChannel}
              onSaved={(v) => {
                setVerification(v);
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
                Configure in Meta App Dashboard — values read from server env vars
              </div>
            </div>
          </div>

          <WebhookSection info={info} />
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
                label="Last verified with Meta"
                value={activeChannel.lastSyncAt ? new Date(activeChannel.lastSyncAt).toLocaleString() : 'Never'}
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
            wordBreak: 'break-all',
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}
