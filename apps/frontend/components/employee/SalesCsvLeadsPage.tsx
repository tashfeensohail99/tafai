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
import { renderWelcomeMessage, waMeLink } from '@/lib/lead-imports-api';

/**
 * Sales agent view of leads sourced from CSV/Excel uploads. Each row gets
 * a WhatsApp button that opens the rep's PERSONAL WhatsApp with the
 * welcome message pre-filled — Tashfeen policy is to use personal numbers
 * to avoid the 24-hour Meta-API window cost. The welcome message asks
 * the customer to reply to the business number, which is when the lead
 * enters the WhatsApp CRM proper.
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
        description="Leads assigned to you from spreadsheet uploads. Click the WhatsApp button to send the welcome message from your personal number."
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
                  {['Lead', 'Phone', 'Status', 'Batch', 'Assigned', ''].map((h) => (
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
                  const link = waMeLink(lead.phone, text);
                  return (
                    <tr key={lead.id} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <Link href={`/sales/leads/${lead.id}` as Route} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                          {lead.firstName} {lead.lastName}
                        </Link>
                        <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                          <CsvLeadBadge />
                          {' · '}{lead.referenceCode}
                          {lead.targetCountry ? ` · ${lead.targetCountry}` : ''}
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
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sos-btn sos-btn--primary sos-btn--sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#25D366', borderColor: '#25D366', color: '#fff' }}
                          title="Opens WhatsApp on this device with the welcome message pre-filled"
                        >
                          <MessageSquare size={13} /> WhatsApp
                        </a>
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

// Compact inline badge — same shape used in admin lead lists, and later
// surfaced on the lead profile + WhatsApp inbox thread row (slice 8).
function CsvLeadBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: 'var(--sos-brand-primary-soft)',
        color: 'var(--sos-brand-primary-strong)',
        border: '1px solid var(--sos-brand-primary-border)',
        borderRadius: 4,
      }}
    >
      CSV LEAD
    </span>
  );
}
