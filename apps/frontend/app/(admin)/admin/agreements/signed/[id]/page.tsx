'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ArrowLeft } from 'lucide-react';
import { GlassCard, PageHeader, StatusBadge, GhostButton } from '@/components/sales-v2/ui';
import type { BadgeTone } from '@/components/sales-v2/ui/StatusBadge';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import {
  getSignedAgreementDetail,
  type SignedAgreementDetail,
} from '@/lib/agreements-admin';

function money(amount: string | number | null | undefined, currency: string): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function statusTone(s: string): BadgeTone {
  switch (s) {
    case 'SIGNED': return 'success';
    case 'APPROVED': return 'accent';
    case 'SENT': return 'info';
    case 'SUBMITTED':
    case 'FINANCE_REVIEW': return 'warning';
    case 'CHANGES_REQUESTED': return 'danger';
    default: return 'neutral';
  }
}

const th: CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-faint)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '9px 12px', fontSize: 13, verticalAlign: 'top' };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 13.5 }}>
      <div style={{ minWidth: 130, color: 'var(--sos-text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );
}

export default function SignedAgreementDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user } = useAdminSession();
  const canView =
    user.permissions.includes('settings.manage') || user.permissions.includes('finance.view_all');

  const [data, setData] = useState<SignedAgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView || !id) return;
    let cancelled = false;
    setLoading(true);
    getSignedAgreementDetail(id)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, canView]);

  if (!canView) {
    return <PermissionDeniedState message="You need the settings.manage or finance.view_all permission." />;
  }

  const bio = data?.bioData ?? {};
  const plan = data?.paymentPlan ?? null;
  const currency = data?.currency ?? plan?.currency ?? 'PKR';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <GhostButton size="sm" iconLeft={<ArrowLeft size={15} />} onClick={() => router.push('/admin/agreements/signed' as Route)}>
          Back to Signed Agreements
        </GhostButton>
      </div>

      {loading ? (
        <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Loading…</div>
      ) : error ? (
        <div className="sos-banner sos-banner--danger">{error}</div>
      ) : !data ? (
        <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Not found.</div>
      ) : (
        <>
          <PageHeader
            eyebrow={data.template?.programTitle ?? data.categoryKey}
            title={data.agreementNumber}
            description={
              data.lead ? `${data.lead.firstName} ${data.lead.lastName} · ${data.lead.phone ?? data.lead.referenceCode}` : undefined
            }
            actions={<StatusBadge tone={statusTone(data.status)}>{data.status.replace(/_/g, ' ')}</StatusBadge>}
          />

          {/* Applicant bio */}
          <GlassCard variant="default">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Applicant details</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 24px' }}>
              <div>
                <Row label="Name" value={bio.applicantName} />
                <Row label="Father name" value={bio.fatherName} />
                <Row label="CNIC" value={bio.cnic} />
                <Row label="Passport" value={bio.passport} />
                <Row label="Date of birth" value={bio.dob} />
                <Row label="Nationality" value={bio.nationality} />
              </div>
              <div>
                <Row label="Phone" value={bio.phone ?? data.lead?.phone} />
                <Row label="Email" value={bio.email ?? data.lead?.email} />
                <Row label="Address" value={bio.address} />
                <Row label="File number" value={bio.fileNumber} />
                <Row label="Destination" value={bio.country} />
                <Row label="Agreement date" value={bio.agreementDate} />
              </div>
            </div>
          </GlassCard>

          {/* Payment plan */}
          <GlassCard variant="default">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Payment plan</div>
              <div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>
                {plan?.planType ?? '—'} · Net {money(plan?.netPayable ?? data.totalAmount, currency)}
              </div>
            </div>
            {plan?.installments?.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--sos-border)' }}>
                      <th style={th}>#</th>
                      <th style={th}>Stage</th>
                      <th style={th}>Trigger</th>
                      <th style={th}>Due</th>
                      <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.installments.map((i, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--sos-border)' }}>
                        <td style={td}>{i.sequence ?? idx + 1}</td>
                        <td style={td}>{i.stage}</td>
                        <td style={{ ...td, color: 'var(--sos-text-muted)' }}>{i.trigger ?? '—'}</td>
                        <td style={td}>{i.dueDate ? fmtDate(i.dueDate) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(i.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sos-text-muted" style={{ fontSize: 13 }}>Single full payment of {money(data.totalAmount, currency)}.</div>
            )}
          </GlassCard>

          {/* Finance ledger */}
          <GlassCard variant="default">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Finance ledger</div>
            {!data.contract && data.invoices.length === 0 ? (
              <div className="sos-text-muted" style={{ fontSize: 13 }}>
                No ledger yet — a service contract materialises when Finance approves this agreement.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {data.contract ? (
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{data.contract.contractNumber}</span>{' '}
                    <StatusBadge tone={data.contract.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">
                      {data.contract.status}
                    </StatusBadge>{' '}
                    · Total {money(data.contract.totalAmount, data.contract.currency)} · signed {fmtDate(data.contract.signedDate)}
                  </div>
                ) : null}

                {data.invoices.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--sos-border)' }}>
                          <th style={th}>Invoice</th>
                          <th style={th}>Status</th>
                          <th style={{ ...th, textAlign: 'right' }}>Total</th>
                          <th style={{ ...th, textAlign: 'right' }}>Paid</th>
                          <th style={th}>Receipts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.invoices.map((inv) => (
                          <tr key={inv.id} style={{ borderBottom: '1px solid var(--sos-border)' }}>
                            <td style={{ ...td, fontFamily: 'monospace' }}>{inv.invoiceNumber}</td>
                            <td style={td}>
                              <StatusBadge
                                tone={inv.status === 'PAID' ? 'success' : inv.status === 'PARTIALLY_PAID' ? 'warning' : 'neutral'}
                                size="sm"
                              >
                                {inv.status.replace(/_/g, ' ')}
                              </StatusBadge>
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>{money(inv.totalAmount, inv.currency)}</td>
                            <td style={{ ...td, textAlign: 'right' }}>{money(inv.paidAmount, inv.currency)}</td>
                            <td style={td}>
                              {inv.receipts.length === 0 ? (
                                <span className="sos-text-faint">—</span>
                              ) : (
                                inv.receipts.map((rc) => (
                                  <div key={rc.id} style={{ fontFamily: 'monospace', fontSize: 12, textDecoration: rc.voidedAt ? 'line-through' : 'none', color: rc.voidedAt ? 'var(--sos-text-faint)' : undefined }}>
                                    {rc.receiptNumber} {money(rc.amount, rc.currency)}
                                    {rc.voidedAt ? ' (void)' : ''}
                                  </div>
                                ))
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )}
          </GlassCard>

          {/* Change requests + events */}
          <GlassCard variant="default">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>History</div>
            {data.changeRequests.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginBottom: 4 }}>Correction requests</div>
                {data.changeRequests.map((cr) => (
                  <div key={cr.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                    <StatusBadge tone={cr.status === 'PENDING' ? 'warning' : cr.status === 'APPLIED' ? 'success' : 'neutral'} size="sm">
                      {cr.status}
                    </StatusBadge>
                    <span>{cr.type === 'BIO' ? 'Bio change' : 'Payment-plan change'}</span>
                    <span className="sos-text-muted">{cr.reason ?? ''}</span>
                    <span className="sos-text-faint" style={{ marginLeft: 'auto' }}>{fmtDate(cr.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginBottom: 4 }}>Timeline</div>
            {data.events.length === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 13 }}>No events.</div>
            ) : (
              data.events.map((ev) => (
                <div key={ev.id} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0' }}>
                  <span className="sos-text-faint" style={{ minWidth: 96 }}>{fmtDate(ev.createdAt)}</span>
                  <span style={{ fontWeight: 500 }}>{ev.type}</span>
                  <span className="sos-text-muted">{ev.summary}</span>
                </div>
              ))
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
