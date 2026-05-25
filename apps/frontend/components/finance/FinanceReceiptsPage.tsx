'use client';

// Finance Receipts — the issued-receipts ledger. Lists every real Receipt
// row (issued automatically when a payment is verified), newest first, with
// search and one-click PDF download. No mock data, no client-side numbering.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Receipt as ReceiptIcon, Search, Send } from 'lucide-react';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  SecondaryButton,
} from '@/components/sales-v2/ui';
import {
  fetchReceipts,
  getReceiptDownloadUrl,
  sendReceiptToClient,
  METHOD_LABEL,
  type ApiIssuedReceipt,
} from '@/lib/finance-api';

const money = (n: number, ccy: string) =>
  `${ccy} ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const th: CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '12px 14px', fontSize: 13, color: 'var(--sos-text-secondary)', borderBottom: '1px solid var(--sos-border-subtle)' };
const tdRight: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export function FinanceReceiptsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ApiIssuedReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      setRows(await fetchReceipts(q));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load receipts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(search), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [search, load]);

  const totals = useMemo(() => {
    const ccy = rows[0]?.currency ?? 'CAD';
    return { count: rows.length, amount: rows.reduce((s, r) => s + r.amount, 0), ccy };
  }, [rows]);

  const download = async (id: string) => {
    setDownloading(id);
    setError(null);
    try {
      const { url } = await getReceiptDownloadUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open receipt');
    } finally {
      setDownloading(null);
    }
  };

  const sendToClient = async (id: string) => {
    setSending(id);
    setError(null);
    setNotice(null);
    try {
      const { to } = await sendReceiptToClient(id);
      setNotice(`Receipt emailed to ${to}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the receipt');
    } finally {
      setSending(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Finance"
        title="Receipts"
        description="Every receipt issued to a client — generated automatically when a payment is verified."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard label="Receipts issued" value={String(totals.count)} tone="accent" Icon={ReceiptIcon} />
        <MetricCard label="Total receipted" value={money(totals.amount, totals.ccy)} tone="success" />
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-faint)' }} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by receipt no, customer, or reference…"
          aria-label="Search receipts"
          style={{
            width: '100%', padding: '10px 12px 10px 34px', borderRadius: 'var(--sos-radius-md)',
            border: '1px solid var(--sos-border)', background: 'var(--sos-input-bg)',
            color: 'var(--sos-text-primary)', fontSize: 13.5,
          }}
        />
      </div>

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}
      {notice ? <div className="sos-banner sos-banner--success">{notice}</div> : null}

      <GlassCard variant="default" padded={false}>
        {loading ? (
          <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading receipts…</div>
        ) : rows.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center', fontSize: 13 }}>
            {search ? 'No receipts match your search.' : 'No receipts issued yet. A receipt is created automatically the moment a payment is verified.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={th}>Receipt</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Method</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Issued</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12.5, color: 'var(--sos-text-primary)' }}>{r.receiptNumber}</td>
                    <td style={td}>
                      {r.leadId ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/finance/clients/${r.leadId}` as Route)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--sos-text-primary)', fontWeight: 600 }}
                        >
                          {r.customerName}
                        </button>
                      ) : (
                        <span style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.customerName}</span>
                      )}
                      {r.referenceCode ? <div style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--sos-text-faint)' }}>{r.referenceCode}</div> : null}
                    </td>
                    <td style={td}>{r.paymentMethod ? (METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod) : '—'}</td>
                    <td style={tdRight}>{money(r.amount, r.currency)}</td>
                    <td style={td}>{fmtDate(r.issuedAt)}</td>
                    <td style={{ ...tdRight }}>
                      <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                        <SecondaryButton
                          size="sm"
                          iconLeft={downloading === r.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
                          onClick={() => void download(r.id)}
                          disabled={downloading !== null || sending !== null}
                        >
                          PDF
                        </SecondaryButton>
                        <SecondaryButton
                          size="sm"
                          iconLeft={sending === r.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
                          onClick={() => void sendToClient(r.id)}
                          disabled={downloading !== null || sending !== null}
                        >
                          Send
                        </SecondaryButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
