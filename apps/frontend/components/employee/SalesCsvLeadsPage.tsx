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
import { renderWelcomeMessage, waWebLink } from '@/lib/lead-imports-api';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';

/**
 * Sales agent view of leads sourced from CSV/Excel uploads. On import each lead
 * is auto-sent a WhatsApp TEMPLATE (business number) and a second one ~40h later
 * if they stay quiet — the "Auto-outreach" column shows that drip's progress.
 * A lead leaves this list the moment the customer REPLIES (it becomes a live
 * inbox conversation). If BOTH auto-touches go unanswered, the row surfaces a
 * personal-WhatsApp button so the rep can escalate on their own number (the old
 * behaviour, now a deliberate last resort rather than the first touch).
 */

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
  no_channel: 'No WA channel',
  no_template: 'Template missing',
  invalid_phone: 'Bad number',
};
// No auto-fallback for these: opt-out/block must be respected, a bad number
// can't be messaged, and daily_cap re-sends itself automatically.
const NO_FALLBACK = new Set(['opted_out', 'blocked', 'invalid_phone', 'daily_cap']);

/** Drip status + whether to offer the personal-WhatsApp escalation button. */
function dripCell(lead: ApiCsvLead): { label: string; tone: BadgeTone; showFallback: boolean } {
  if (lead.dripTouch2At) return { label: '2 sent · no reply', tone: 'warning', showFallback: true };
  if (lead.dripSkippedReason) {
    const r = lead.dripSkippedReason;
    const danger = r === 'opted_out' || r === 'blocked' || r === 'invalid_phone';
    return { label: SKIP_LABEL[r] ?? r, tone: danger ? 'danger' : 'neutral', showFallback: !NO_FALLBACK.has(r) };
  }
  if (lead.dripTouch1At) return { label: 'Touch 1 sent', tone: 'info', showFallback: false };
  return { label: 'Auto-message queued', tone: 'neutral', showFallback: false };
}

export function SalesCsvLeadsPage() {
  const [leads, setLeads] = useState<ApiCsvLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState<string>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiFetch<ApiCsvLead[]>('/leads?fromCsv=true');
      setLeads(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      if (batchFilter !== 'ALL') {
        const b = lead.importRows?.[0]?.batch;
        if (!b || b.id !== batchFilter) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${lead.firstName} ${lead.lastName} ${lead.phone} ${lead.email ?? ''} ${lead.referenceCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, batchFilter, search]);

  const newCount = useMemo(() => leads.filter((l) => l.status === 'NEW').length, [leads]);
  const contactedCount = useMemo(() => leads.filter((l) => l.status === 'CONTACTED').length, [leads]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Sales · CSV Leads"
        title="CSV Leads"
        description="Leads assigned to you from spreadsheet uploads. Each is auto-sent a WhatsApp template on import (and a follow-up ~40h later if they stay quiet). A lead leaves this list once they reply; if both auto-touches go unanswered, use the WhatsApp button to continue on your personal number."
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard label="My CSV leads" value={leads.length} tone="info" Icon={FileSpreadsheet} hint="Across all batches" />
        <MetricCard label="New" value={newCount} tone="accent" Icon={Tag} hint="Awaiting first contact" />
        <MetricCard label="Contacted" value={contactedCount} tone="warning" Icon={MessageSquare} hint="In conversation" />
        <MetricCard label="Active batches" value={batches.length} tone="neutral" Icon={FileSpreadsheet} hint="Distinct uploads" />
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
                  const text = renderWelcomeMessage(null, { firstName: lead.firstName });
                  const link = waWebLink(lead.phone, text);
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
                          const d = dripCell(lead);
                          return (
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                              <StatusBadge tone={d.tone} size="sm">{d.label}</StatusBadge>
                              {d.showFallback ? (
                                <a
                                  href={link}
                                  target="tashfeen-whatsapp"
                                  onClick={(e) => {
                                    // Reuse ONE WhatsApp tab instead of spawning a fresh,
                                    // cold-loading tab on every click. window.open with a
                                    // fixed window name navigates the existing WhatsApp tab
                                    // to the new chat and focuses it.
                                    e.preventDefault();
                                    const w = window.open(link, 'tashfeen-whatsapp');
                                    if (w) w.focus();
                                  }}
                                  className="sos-btn sos-btn--primary sos-btn--sm"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#25D366', borderColor: '#25D366', color: '#fff' }}
                                  title="No reply after 2 auto-messages — continue on your personal WhatsApp"
                                >
                                  <MessageSquare size={13} /> WhatsApp
                                </a>
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
    </div>
  );
}

