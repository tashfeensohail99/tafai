'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Download, Key, Loader2, MessageSquare, Pause, Phone, Play, Plus, RotateCw } from 'lucide-react';
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
  setChannelStatus,
  syncChannelTemplates,
  type AdminChannel,
} from '@/lib/whatsapp-admin';
import { Modal } from '@/components/whatsapp/Modal';

export default function WhatsAppChannelsAdminPage() {
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChannels(await listChannels());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp"
        title="Connected business numbers"
        description="Day-to-day operations on already-connected Meta numbers — pause / resume routing, re-sync approved templates, and monitor messaging tier."
        actions={
          <PrimaryButton iconLeft={<Plus size={14} />} onClick={() => setConnectOpen(true)}>
            Connect channel
          </PrimaryButton>
        }
      />

      <div
        className="sos-banner sos-banner--info"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5 }}
      >
        <Key size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          First-time setup, credential rotation, webhook URL, and the security env-var checklist
          all live on{' '}
          <strong>
            <Link
              href={'/admin/settings/integrations' as Route}
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              Settings → Integrations
            </Link>
          </strong>
          . That page also runs a live Meta Graph API verification right after you paste
          credentials. This page is for the ongoing operations on already-verified numbers.
        </span>
      </div>

      <GlassCard variant="default" padded="lg">
        {loading ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading channels…
          </div>
        ) : error ? (
          <div className="sos-banner sos-banner--danger">
            <span>{error}</span>
          </div>
        ) : channels.length === 0 ? (
          <EmptyState
            Icon={Phone}
            title="No WhatsApp channels connected"
            description="Connect Tashfeen's official WhatsApp Business Cloud API number to start routing leads through the inbox."
            action={
              <PrimaryButton iconLeft={<Plus size={14} />} onClick={() => setConnectOpen(true)}>
                Connect channel
              </PrimaryButton>
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {channels.map((c) => (
              <ChannelRow key={c.id} channel={c} onChanged={reload} />
            ))}
          </div>
        )}
      </GlassCard>

      <ConnectChannelModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => {
          setConnectOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

function ChannelRow({
  channel,
  onChanged,
}: {
  channel: AdminChannel;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const tone = channel.status === 'ACTIVE' ? 'success' : channel.status === 'PAUSED' ? 'warning' : 'danger';
  const flip = useMemo(
    () => async (next: AdminChannel['status']) => {
      setBusy(true);
      try {
        await setChannelStatus(channel.id, next);
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [channel.id, onChanged],
  );

  async function handleSync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      await syncChannelTemplates(channel.id);
      setSyncNote('Sync queued — refresh in a moment to see updated templates.');
      setTimeout(() => setSyncNote(null), 5000);
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : 'Failed to queue sync');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: 14,
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
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
          }}
        >
          <MessageSquare size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>{channel.label}</div>
          <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
            {channel.displayNumber} · phone_number_id {channel.phoneNumberId}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <StatusBadge tone={tone} size="sm" dot>{channel.status.toLowerCase()}</StatusBadge>
        <StatusBadge tone="info" size="sm">{channel.tier.replace('TIER_', '').toLowerCase()}</StatusBadge>
        <GhostButton
          size="sm"
          disabled={syncing}
          iconLeft={syncing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={12} />}
          onClick={() => void handleSync()}
          title="Pull the latest approved-template list from Meta"
        >
          {syncing ? 'Queuing…' : 'Sync templates'}
        </GhostButton>
        {channel.status === 'ACTIVE' ? (
          <GhostButton
            size="sm"
            disabled={busy}
            iconLeft={<Pause size={12} />}
            onClick={() => void flip('PAUSED')}
          >
            Pause
          </GhostButton>
        ) : (
          <GhostButton
            size="sm"
            disabled={busy}
            iconLeft={<Play size={12} />}
            onClick={() => void flip('ACTIVE')}
          >
            Resume
          </GhostButton>
        )}
      </div>
      {syncNote ? (
        <div
          style={{
            flexBasis: '100%',
            fontSize: 12,
            color: 'var(--sos-text-muted)',
            marginTop: 4,
          }}
        >
          {syncNote}
        </div>
      ) : null}
    </div>
  );
}

function ConnectChannelModal(props: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [label, setLabel] = useState('Tashfeen Main');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [displayNumber, setDisplayNumber] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setLabel('Tashfeen Main');
    setWabaId('');
    setPhoneNumberId('');
    setDisplayNumber('');
    setAccessToken('');
    setSubmitting(false);
    setError(null);
  }, [props.open]);

  const onSubmit = async () => {
    if (!label || !wabaId || !phoneNumberId || !displayNumber || !accessToken) {
      setError('All fields are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await connectChannel({ label, wabaId, phoneNumberId, displayNumber, accessToken });
      props.onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect channel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Connect WhatsApp Business number"
      width={580}
      footer={
        <>
          <GhostButton onClick={props.onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={onSubmit}
            disabled={submitting}
            iconLeft={submitting ? <RotateCw size={14} /> : <Plus size={14} />}
          >
            {submitting ? 'Connecting…' : 'Connect'}
          </PrimaryButton>
        </>
      }
    >
      <p className="sos-text-secondary" style={{ fontSize: 'var(--sos-text-sm)' }}>
        Paste credentials from Meta's WhatsApp Business Cloud API dashboard. The access token is
        encrypted before being stored; we never display it again.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <Field label="Label" required hint="Friendly name (e.g. Tashfeen Main)">
          <FormInput value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Display number" required hint="As shown to customers">
          <FormInput
            value={displayNumber}
            onChange={(e) => setDisplayNumber(e.target.value)}
            placeholder="+92 ..."
          />
        </Field>
        <Field label="WABA ID" required>
          <FormInput value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
        </Field>
        <Field label="Phone number ID" required hint="From Meta App → WhatsApp → API Setup">
          <FormInput
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Access token" required hint="System User permanent token recommended">
          <FormInput
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            type="password"
            placeholder="EAAB…"
          />
        </Field>
      </div>
      {error && (
        <div className="sos-banner sos-banner--danger" style={{ marginTop: 12 }}>
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}
