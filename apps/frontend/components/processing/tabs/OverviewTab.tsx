'use client';

import { useMemo } from 'react';
import {
  Phone,
  Mail,
  UserRound,
  CalendarClock,
  Wallet,
  FolderOpen,
  MessageSquare,
  FileText,
  StickyNote,
  Send,
  ArrowRight,
} from 'lucide-react';
import type { MockProcessingCase } from '../mockData';
import type { ApiProcessingCaseDetail, CaseFinanceSummary } from '@/lib/processing';
import { InternalNotesTab } from './InternalNotesTab';
import { CommunicationsTab } from './CommunicationsTab';

/** Tabs the Overview quick-links can jump to (a subset of the workspace TabKey). */
export type OverviewLinkTab = 'databank' | 'whatsapp' | 'documents' | 'finance' | 'communications';

interface OverviewTabProps {
  c: MockProcessingCase;
  api: ApiProcessingCaseDetail;
  finance: CaseFinanceSummary | null;
  financeLoading: boolean;
  onOpenTab: (tab: OverviewLinkTab) => void;
}

const muted = 'var(--sos-text-muted, #64748b)';
const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';
const cardBg = 'var(--sos-surface, rgba(255,255,255,0.6))';

function fmtMoney(n: number, currency: string): string {
  return `${currency} ${Math.round(n).toLocaleString()}`;
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Overview — the processing team's "one page" case view (Suggested Interface,
 * 2026-09). Everything an associate needs day-to-day on a single scroll:
 * sign-up + contact, the money picture, quick links to Databank/WhatsApp, the
 * notes log, and the email composer + history — the last two reuse the existing
 * Notes and Comms tabs verbatim. The structured tools (Milestones, Documents,
 * Submissions, …) stay one click away on their own tabs.
 */
export function OverviewTab({ c, api, finance, financeLoading, onOpenTab }: OverviewTabProps) {
  const currency = finance?.currency ?? c.financeCurrency ?? 'PKR';

  const firstInstalmentDate = useMemo(() => {
    const due = (finance?.invoices ?? [])
      .map((i) => i.dueDate)
      .filter((d): d is string => !!d)
      .sort();
    return due[0] ?? null;
  }, [finance]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Sign-up & contact ─────────────────────────────────────────────── */}
      <Card title="Sign-up & contact details">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px 20px' }}>
          <Field icon={<Phone size={14} />} label="Contact no" value={c.clientPhone || api.client.phone || '—'} />
          <Field icon={<Mail size={14} />} label="Email" value={api.client.email || '—'} />
          <Field icon={<UserRound size={14} />} label="Sale person" value={c.salesRep?.name || '—'} />
          <Field icon={<CalendarClock size={14} />} label="Signed up (handover)" value={fmtDate(api.financeHandover?.submittedAt)} />
          <Field icon={<UserRound size={14} />} label="Processing officer" value={c.assignedOfficer?.name || 'Unassigned'} />
          <Field icon={<FileText size={14} />} label="Service" value={`${c.service} · ${c.targetCountry}`} />
        </div>
        {api.financeHandoverNote ? (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: border, fontSize: 12.5, color: 'var(--sos-text-secondary, #4b5563)' }}>
            <span style={{ fontWeight: 600 }}>Handover note (from Finance): </span>
            {api.financeHandoverNote}
          </div>
        ) : null}
      </Card>

      {/* ── Account details (finance) ─────────────────────────────────────── */}
      <Card
        title="Account details"
        action={<LinkBtn onClick={() => onOpenTab('finance')} label="Open Finance" />}
      >
        {financeLoading ? (
          <div style={{ color: muted, fontSize: 13 }}>Loading finance…</div>
        ) : !finance || finance.totalAgreed === 0 ? (
          <div style={{ color: muted, fontSize: 13 }}>No finance record on this case yet.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px 20px' }}>
              <Stat label="Closing amount" value={fmtMoney(finance.totalAgreed, currency)} />
              <Stat label="Instalment paid" value={fmtMoney(finance.totalPaid, currency)} tone="good" />
              <Stat label="Balance due" value={fmtMoney(finance.balance, currency)} tone={finance.balance > 0 ? 'warn' : 'good'} />
              <Stat label="First instalment" value={fmtDate(firstInstalmentDate)} />
            </div>
            {finance.invoices.length > 0 ? (
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: muted, marginBottom: 6 }}>
                  Instalment plan
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 460 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: muted }}>
                      <th style={th}>Invoice</th>
                      <th style={th}>Due</th>
                      <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                      <th style={{ ...th, textAlign: 'right' }}>Paid</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={td}>{inv.invoiceNumber}</td>
                        <td style={td}>{fmtDate(inv.dueDate)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(inv.totalAmount, inv.currency)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(inv.paidAmount, inv.currency)}</td>
                        <td style={td}>{inv.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {/* ── Quick links ───────────────────────────────────────────────────── */}
      <Card title="Quick links">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <QuickLink icon={<FolderOpen size={16} />} label="Databank" onClick={() => onOpenTab('databank')} />
          <QuickLink icon={<MessageSquare size={16} />} label="WhatsApp" onClick={() => onOpenTab('whatsapp')} />
          <QuickLink icon={<FileText size={16} />} label="Documents" onClick={() => onOpenTab('documents')} />
          <QuickLink icon={<Wallet size={16} />} label="Finance" onClick={() => onOpenTab('finance')} />
        </div>
      </Card>

      {/* ── Notes (reuses the Notes tab: author + edit time) ──────────────── */}
      <Section icon={<StickyNote size={15} />} title="Notes">
        <InternalNotesTab c={c} />
      </Section>

      {/* ── Compose email + sent history (reuses the Comms tab) ───────────── */}
      <Section icon={<Send size={15} />} title="Email">
        <CommunicationsTab c={c} />
      </Section>
    </div>
  );
}

/* ── small presentational helpers ──────────────────────────────────────────── */

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border, borderRadius: 14, background: cardBg, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ border, borderRadius: 14, background: cardBg, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: 13.5, marginBottom: 12, color: 'var(--sos-accent, #b8860b)' }}>
        {icon}
        <span style={{ color: 'var(--sos-text-primary, #0f172a)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: muted }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 13.5, marginTop: 3, color: 'var(--sos-text-primary, #0f172a)', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? '#15803d' : tone === 'warn' ? '#b45309' : 'var(--sos-text-primary, #0f172a)';
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: muted }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3, color }}>{value}</div>
    </div>
  );
}

function QuickLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border,
        borderRadius: 10,
        padding: '9px 14px',
        background: 'var(--sos-surface-solid, #fff)',
        color: 'var(--sos-text-primary, #0f172a)',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      <span style={{ color: 'var(--sos-accent, #b8860b)' }}>{icon}</span>
      {label}
    </button>
  );
}

function LinkBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: 'none',
        background: 'transparent',
        color: 'var(--sos-brand-primary-strong, #2563eb)',
        fontSize: 12.5,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {label} <ArrowRight size={13} />
    </button>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))', whiteSpace: 'nowrap' };
