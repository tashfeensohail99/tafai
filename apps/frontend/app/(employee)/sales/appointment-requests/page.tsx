'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { AlertTriangle, CalendarClock, MessageCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  FormInput,
  FormSelect,
  GhostButton,
  GlassCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  listAppointmentRequests,
  rejectAppointmentRequest,
  type AppointmentRequestRow,
} from '@/lib/appointment-requests';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
];

const MODALITY_LABEL: Record<string, string> = {
  CALL: 'Phone call',
  VIDEO: 'Google Meet',
  IN_PERSON: 'Office visit',
  UNKNOWN: '—',
};

const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
};

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return `${Math.floor(ms / 60_000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AppointmentRequestsPage() {
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AppointmentRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listAppointmentRequests({ status, search: search.trim() || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleReject = async (id: string) => {
    if (!confirm('Reject this appointment request? It will move out of the PENDING list.')) return;
    setBusy(`reject:${id}`);
    try {
      await rejectAppointmentRequest(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Sales · Bot capture"
        title="Appointment requests"
        description="Bot-captured booking intent from WhatsApp conversations. PENDING = waiting on sales to confirm. Confirming via the chat panel (Book now button) auto-marks the request CONFIRMED."
        actions={
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
            Refresh
          </GhostButton>
        }
      />

      <GlassCard variant="default" padded="md">
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <FormSelect
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={STATUS_OPTIONS}
          />
          <FormInput
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or phone"
          />
        </div>
      </GlassCard>

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>
          Loading requests…
        </div>
      ) : rows.length === 0 ? (
        <GlassCard variant="default" padded="lg">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 32 }}>
            <Sparkles size={20} className="sos-text-faint" />
            <div className="sos-text-faint" style={{ fontSize: 13 }}>
              No {status.toLowerCase()} requests. When the bot captures a customer's day/time preference, it'll land here.
            </div>
          </div>
        </GlassCard>
      ) : (
        <GlassCard variant="default" padded={false}>
          {/* Mobile (<640px): stacked cards — the 7-col table needs horizontal
              scroll on a phone. Actions (Open chat / Reject) are preserved. */}
          <div className="sm:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
            {rows.map((r) => {
              const tags = [r.preferredDay, r.preferredTime].filter(Boolean).join(' · ') || '(unspecified)';
              const agentName = r.lead?.assignedEmployee
                ? `${r.lead.assignedEmployee.firstName ?? ''} ${r.lead.assignedEmployee.lastName ?? ''}`.trim() || '—'
                : '—';
              return (
                <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, border: '1px solid var(--sos-border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 14 }}>{r.lead?.firstName} {r.lead?.lastName}</strong>
                      <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 2 }}>{r.lead?.phone}</div>
                    </div>
                    <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'} size="sm" dot={false}>
                      {r.status.toLowerCase()}
                    </StatusBadge>
                  </div>
                  <div style={{ fontSize: 13 }}>{tags}</div>
                  <div className="sos-text-faint" style={{ fontSize: 11.5 }} title={r.rawText}>
                    "{r.rawText.slice(0, 80)}{r.rawText.length > 80 ? '…' : ''}"
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--sos-text-faint)' }}>
                    <span>{MODALITY_LABEL[r.modality ?? 'UNKNOWN']}</span>
                    <span>{ageLabel(r.createdAt)}</span>
                    <span>{agentName}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.threadId ? (
                      <Link href={`/sales/inbox?threadId=${r.threadId}` as Route} style={{ textDecoration: 'none' }}>
                        <GhostButton size="sm" iconLeft={<MessageCircle size={13} />}>Open chat</GhostButton>
                      </Link>
                    ) : null}
                    {r.status === 'PENDING' ? (
                      <GhostButton size="sm" iconLeft={<X size={13} />} onClick={() => void handleReject(r.id)} disabled={busy !== null}>
                        Reject
                      </GhostButton>
                    ) : null}
                    {r.status === 'CONFIRMED' ? (
                      <span className="sos-text-faint" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <CalendarClock size={12} /> booked
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop (>=640px): full table. */}
          <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  {['Client', 'Captured intent', 'Modality', 'Age', 'Assigned', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 14px',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        color: 'var(--sos-text-faint)',
                        borderBottom: '1px solid var(--sos-border-subtle)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tags = [r.preferredDay, r.preferredTime].filter(Boolean).join(' · ') || '(unspecified)';
                  const agentName = r.lead?.assignedEmployee
                    ? `${r.lead.assignedEmployee.firstName ?? ''} ${r.lead.assignedEmployee.lastName ?? ''}`.trim() || '—'
                    : '—';
                  return (
                    <tr key={r.id}>
                      <td style={td}>
                        <div>
                          <strong style={{ fontSize: 13.5 }}>{r.lead?.firstName} {r.lead?.lastName}</strong>
                          <div className="sos-text-faint" style={{ fontSize: 11.5, marginTop: 2 }}>{r.lead?.phone}</div>
                        </div>
                      </td>
                      <td style={td}>
                        <div style={{ fontSize: 13 }}>{tags}</div>
                        <div
                          className="sos-text-faint"
                          style={{ fontSize: 11, marginTop: 4, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={r.rawText}
                        >
                          "{r.rawText.slice(0, 80)}{r.rawText.length > 80 ? '…' : ''}"
                        </div>
                      </td>
                      <td style={td}>{MODALITY_LABEL[r.modality ?? 'UNKNOWN']}</td>
                      <td style={td}>{ageLabel(r.createdAt)}</td>
                      <td style={td}>{agentName}</td>
                      <td style={td}>
                        <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'} size="sm" dot={false}>
                          {r.status.toLowerCase()}
                        </StatusBadge>
                      </td>
                      <td style={td}>
                        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                          {r.threadId ? (
                            <Link href={`/sales/inbox?threadId=${r.threadId}` as Route} style={{ textDecoration: 'none' }}>
                              <GhostButton size="sm" iconLeft={<MessageCircle size={13} />}>
                                Open chat
                              </GhostButton>
                            </Link>
                          ) : null}
                          {r.status === 'PENDING' ? (
                            <GhostButton
                              size="sm"
                              iconLeft={<X size={13} />}
                              onClick={() => void handleReject(r.id)}
                              disabled={busy !== null}
                            >
                              Reject
                            </GhostButton>
                          ) : null}
                          {r.status === 'CONFIRMED' ? (
                            <span className="sos-text-faint" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <CalendarClock size={12} /> booked
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

const td: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 13,
  color: 'var(--sos-text-secondary)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  verticalAlign: 'top',
};
