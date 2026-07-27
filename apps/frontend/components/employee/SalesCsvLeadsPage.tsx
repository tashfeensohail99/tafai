'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Calendar,
  FileSpreadsheet,
  MessageSquare,
  Phone,
  Search,
  Tag,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { apiFetch } from '@/lib/api-client';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { TemplatePickerModal } from '@/components/whatsapp/TemplatePickerModal';
import { getActiveChannel } from '@/lib/whatsapp';
import { phoneMatches } from '@/lib/phone-search';

/**
 * Sales agent view of leads sourced from CSV/Excel uploads. Leads imported
 * since the auto-drip shipped are auto-sent a WhatsApp TEMPLATE on import and a
 * second one ~40h later if they stay quiet — the "Auto-outreach" column shows
 * that drip's progress. Leads imported BEFORE it shipped were never enqueued
 * and are labelled as such rather than being shown a queue that doesn't exist.
 *
 * Every messageable row offers a WhatsApp button that sends an approved
 * TEMPLATE from the CRM business number (rep picks the template, fills its
 * placeholders). The backend opens the thread, so the conversation is logged in
 * the CRM inbox — no personal-WhatsApp escalation.
 *
 * A lead leaves this list once it is genuinely handled: the customer replied,
 * OR a rep has messaged them.
 */

/**
 * The CSV auto-drip shipped 2026-07-04 (migration 20260704140000_lead_csv_drip)
 * and the column was added with no backfill, so EVERY lead imported before this
 * has null drip state and never had a job enqueued. Without this the page shows
 * them "Auto-message queued" forever and reps stand down waiting for a message
 * that will never send.
 */
const DRIP_LAUNCHED_AT = Date.parse('2026-07-04T00:00:00Z');
/**
 * Touch-1 is enqueued at import with at most a 600s stagger, so a lead with no
 * drip state hours later was never queued either (lost job / cleared queue).
 * Generous enough that a genuinely in-flight touch is never mislabelled.
 */
const DRIP_GRACE_MS = 24 * 60 * 60 * 1000;

interface ApiCsvLead {
  id: string;
  referenceCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  status: string;
  serviceInterest: string | null;
  targetCountry: string | null;
  sourceChannel: string | null;
  notes: string | null;
  createdAt: string;
  // CSV auto-drip state (see csv-drip.service). Nulls until each touch fires.
  dripTouch1At: string | null;
  dripTouch2At: string | null;
  dripSkippedReason: string | null;
  importRows?: Array<{
    id: string;
    createdAt: string;
    batch: { id: string; batchNumber: string; name: string };
  }>;
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'NEW': return 'info';
    case 'CONTACTED': return 'warning';
    case 'QUALIFIED': return 'accent';
    case 'CONVERTED': return 'success';
    case 'LOST': return 'danger';
    default: return 'neutral';
  }
}

const SKIP_LABEL: Record<string, string> = {
  opted_out: 'Opted out',
  blocked: 'Blocked',
  recently_active: 'Already active',
  daily_cap: 'Sending soon',
  no_channel: 'Retrying (channel)',
  no_template: 'Retrying (template)',
  invalid_phone: 'Bad number',
  thread_conflict: 'Duplicate contact',
  converted_client: 'Existing client',
};
// Manual outreach is withheld ONLY where messaging is wrong or impossible:
// opted out (marketing consent withdrawn), blocked (the backend refuses it
// anyway), an unusable number, an existing client, or a duplicate whose real
// conversation already lives in the inbox. A stalled drip (daily_cap /
// no_channel / no_template) is exactly when a rep SHOULD be able to step in
// manually, so those are messageable.
const NEVER_MESSAGE = new Set([
  'opted_out', 'blocked', 'invalid_phone', 'thread_conflict', 'converted_client',
]);

/** Drip status + whether the rep may send a template from the CRM. */
function dripCell(
  lead: ApiCsvLead,
  importedAt: string,
): { label: string; tone: BadgeTone; canMessage: boolean; hint: string } {
  if (lead.dripTouch2At) {
    return { label: '2 sent · no reply', tone: 'warning', canMessage: true, hint: 'No reply after 2 auto-messages — send a template from the CRM number' };
  }
  if (lead.dripSkippedReason) {
    const r = lead.dripSkippedReason;
    const danger = r === 'opted_out' || r === 'blocked' || r === 'invalid_phone';
    const canMessage = !NEVER_MESSAGE.has(r);
    return {
      label: SKIP_LABEL[r] ?? r,
      tone: danger ? 'danger' : 'neutral',
      canMessage,
      hint: canMessage
        ? 'Auto-outreach did not send — message them yourself from the CRM number'
        : 'This contact must not be messaged',
    };
  }
  if (lead.dripTouch1At) {
    return { label: 'Touch 1 sent', tone: 'info', canMessage: true, hint: 'Send a template from the CRM number' };
  }
  // No drip state at all. Only genuinely "queued" if this lead was imported
  // after the drip shipped AND recently enough that touch-1 could still fire;
  // otherwise no job was ever enqueued and saying "queued" is a lie that stops
  // reps working the lead.
  const importedMs = Date.parse(importedAt);
  const neverQueued =
    !Number.isFinite(importedMs) ||
    importedMs < DRIP_LAUNCHED_AT ||
    Date.now() - importedMs > DRIP_GRACE_MS;
  return neverQueued
    ? { label: 'No auto-outreach', tone: 'neutral', canMessage: true, hint: 'No automatic message was sent for this lead — contact them from the CRM number' }
    : { label: 'Auto-message queued', tone: 'neutral', canMessage: true, hint: 'Auto-message is queued — you can also message them now from the CRM number' };
}

interface CsvStats {
  total: number;
  contacted: number;
  remaining: number;
  deleted: number;
}

export function SalesCsvLeadsPage() {
  const [leads, setLeads] = useState<ApiCsvLead[]>([]);
  const [stats, setStats] = useState<CsvStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState<string>('ALL');
  // The lead whose template picker is open, and the business number we send
  // from. The channel is fetched once — these leads have no thread yet, so
  // there's no thread.channelId to read it from.
  const [pickerLead, setPickerLead] = useState<ApiCsvLead | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  /**
   * Leads this rep has just templated. The server excludes a lead once
   * thread.lastHumanReplyAt is set, but that is stamped by the outbound worker
   * only AFTER Meta accepts the send — a second or two later. Reloading
   * immediately therefore returns the lead again, the row looks untouched, and
   * the rep re-sends thinking it failed. Hide it locally until the server
   * agrees; this must be applied in `filtered` (not by mutating `leads`)
   * because load() replaces `leads` wholesale.
   */
  const [justSentIds, setJustSentIds] = useState<Set<string>>(() => new Set());
  const [sentNote, setSentNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The list is only the still-cold leads; the stats give the full funnel
      // (total / contacted / remaining) so the KPIs don't shrink as leads reply.
      const [list, s] = await Promise.all([
        apiFetch<ApiCsvLead[]>('/leads?fromCsv=true'),
        apiFetch<CsvStats>('/leads/csv-stats').catch(() => null),
      ]);
      setLeads(list);
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve the sending number once. A failure here only disables the send
  // button (with a reason) — it must never block the list from rendering.
  useEffect(() => {
    getActiveChannel()
      .then((ch) => setChannelId(ch?.id ?? null))
      .catch(() => setChannelId(null));
  }, []);

  // Build unique batch list for filter chips.
  const batches = useMemo(() => {
    const map = new Map<string, { id: string; name: string; batchNumber: string; count: number }>();
    for (const lead of leads) {
      const b = lead.importRows?.[0]?.batch;
      if (!b) continue;
      const existing = map.get(b.id);
      if (existing) existing.count += 1;
      else map.set(b.id, { ...b, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [leads]);

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      // Just templated by this rep — the server hasn't caught up yet.
      if (justSentIds.has(lead.id)) return false;
      if (batchFilter !== 'ALL') {
        const b = lead.importRows?.[0]?.batch;
        if (!b || b.id !== batchFilter) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${lead.firstName} ${lead.lastName} ${lead.phone} ${lead.email ?? ''} ${lead.referenceCode}`.toLowerCase();
        // Numbers are stored +92…, everyone types 0… — the plain substring
        // check alone would miss the lead entirely.
        if (!hay.includes(q) && !phoneMatches(lead.phone, search)) return false;
      }
      return true;
    });
  }, [leads, batchFilter, search, justSentIds]);

  // KPI values from the funnel stats, falling back to list-derived numbers
  // while the stats request is in flight.
  const kTotal = stats?.total ?? leads.length;
  const kContacted = stats?.contacted ?? 0;
  const kRemaining = stats?.remaining ?? leads.length;
  const kDeleted = stats?.deleted ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Sales · CSV Leads"
        title="CSV Leads"
        description="Leads assigned to you from spreadsheet uploads. Use the WhatsApp button to send an approved template from the CRM business number — the chat then appears in your inbox. Leads imported before automatic outreach was switched on show “No auto-outreach”: nothing was ever sent to them, so contact them yourself. A lead leaves this list once they reply or you message them."
      />

      {/* Explicit send confirmation. Without it the only feedback is the row
          vanishing, which reads as "nothing happened" — the exact complaint
          this page had. Dismissible; cleared on the next send. */}
      {sentNote ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={14} />
          <span style={{ flex: 1 }}>{sentNote}</span>
          <button
            type="button"
            onClick={() => setSentNote(null)}
            className="sos-btn sos-btn--ghost sos-btn--sm"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* KPIs — full funnel so the count doesn't "shrink" as leads reply. */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard
          label="Total CSV leads"
          value={kTotal}
          tone="info"
          Icon={FileSpreadsheet}
          hint={kDeleted > 0 ? `Assigned to you · ${kDeleted} removed earlier` : 'Assigned to you'}
        />
        <MetricCard
          label="Contacted"
          value={kContacted}
          tone="success"
          Icon={MessageSquare}
          hint="Auto-messaged, messaged by you, or replied"
        />
        <MetricCard
          label="Remaining"
          value={kRemaining}
          tone="warning"
          Icon={Tag}
          hint="Still to reach — listed below"
        />
        <MetricCard label="Active batches" value={batches.length} tone="neutral" Icon={FileSpreadsheet} hint="With leads still to reach" />
      </div>

      {/* Filters */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setBatchFilter('ALL')} className={batchFilter === 'ALL' ? 'sos-chip sos-chip--active' : 'sos-chip'}>
              All batches
            </button>
            {batches.map((b) => (
              <button
                key={b.id}
                onClick={() => setBatchFilter(b.id)}
                className={batchFilter === b.id ? 'sos-chip sos-chip--active' : 'sos-chip'}
              >
                {b.name} · {b.count}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 220, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, color: 'var(--sos-text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, email, or reference…"
              className="sos-input"
              style={{ paddingLeft: 34 }}
            />
          </div>
        </div>
      </GlassCard>

      {/* List */}
      <GlassCard variant="panel" padded={false}>
        {loading && leads.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            Icon={FileSpreadsheet}
            title="No CSV leads"
            description={
              leads.length === 0
                ? "You don't have any leads from CSV uploads yet."
                : 'No leads match the current filters.'
            }
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 800, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['Lead', 'Phone', 'Status', 'Batch', 'Imported', 'Auto-outreach'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--sos-divider)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => {
                  const batch = lead.importRows?.[0]?.batch;
                  const importedAt = lead.importRows?.[0]?.createdAt ?? lead.createdAt;
                  return (
                    <tr key={lead.id} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <Link href={`/sales/leads/${lead.id}` as Route} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                          {lead.firstName} {lead.lastName}
                        </Link>
                        <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <CsvLeadBadge batchName={batch?.name} />
                          <span>·</span>
                          <span>{lead.referenceCode}</span>
                          {lead.targetCountry ? <><span>·</span><span>{lead.targetCountry}</span></> : null}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Phone size={12} style={{ color: 'var(--sos-text-muted)' }} />
                          {lead.phone}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge tone={statusTone(lead.status)} size="sm">{lead.status}</StatusBadge>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                        {batch ? batch.name : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Calendar size={11} />
                          {new Date(importedAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {(() => {
                          const d = dripCell(lead, importedAt);
                          return (
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                              <StatusBadge tone={d.tone} size="sm">{d.label}</StatusBadge>
                              {d.canMessage ? (
                                <button
                                  type="button"
                                  onClick={() => setPickerLead(lead)}
                                  disabled={!channelId}
                                  className="sos-btn sos-btn--primary sos-btn--sm"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    background: channelId ? '#25D366' : 'var(--sos-surface-2)',
                                    borderColor: channelId ? '#25D366' : 'var(--sos-border-subtle)',
                                    color: channelId ? '#fff' : 'var(--sos-text-muted)',
                                    cursor: channelId ? 'pointer' : 'not-allowed',
                                  }}
                                  title={
                                    channelId
                                      ? d.hint
                                      : 'No active WhatsApp number is configured — ask an admin to connect one.'
                                  }
                                >
                                  <MessageSquare size={13} /> WhatsApp
                                </button>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* First contact from the CRM business number. The backend opens the
          thread, so the conversation lands in the inbox and the lead drops off
          this list on reload. */}
      {pickerLead && channelId ? (
        <TemplatePickerModal
          open
          onClose={() => setPickerLead(null)}
          leadId={pickerLead.id}
          channelId={channelId}
          contactName={pickerLead.firstName}
          onSent={() => {
            const sent = pickerLead;
            setJustSentIds((s) => new Set(s).add(sent.id));
            setSentNote(`Template sent to ${sent.firstName} ${sent.lastName} — the chat is now in your inbox.`);
            setPickerLead(null);
            // Refresh the KPI stats. The row stays hidden either way.
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

