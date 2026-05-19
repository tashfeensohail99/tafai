'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  CheckCircle2,
  Clock,
  Download,
  FileSignature,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  fmtDate,
  fmtMoney,
  getAgreementDownloadUrl,
  listServiceContracts,
  uploadServiceAgreement,
  type ApiServiceContract,
  type ServiceContractStatus,
} from '@/lib/service-contracts-api';

interface Props {
  leadId: string;
  defaultTotalAmount?: string;
  defaultCurrency?: string;
}

function statusTone(status: ServiceContractStatus): BadgeTone {
  switch (status) {
    case 'DRAFT':
      return 'warm';
    case 'ACTIVE':
      return 'success';
    case 'COMPLETED':
      return 'info';
    case 'CANCELLED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function LeadServiceAgreementSection({
  leadId,
  defaultTotalAmount,
  defaultCurrency,
}: Props) {
  const [contracts, setContracts] = useState<ApiServiceContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [totalAmount, setTotalAmount] = useState(defaultTotalAmount ?? '');
  const [currency, setCurrency] = useState(defaultCurrency ?? 'CAD');
  const [signedDate, setSignedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listServiceContracts({ leadId });
      setContracts(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load contracts');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  function resetForm() {
    setFile(null);
    setTotalAmount(defaultTotalAmount ?? '');
    setCurrency(defaultCurrency ?? 'CAD');
    setSignedDate('');
    setNotes('');
    setError(null);
  }

  function closeUpload() {
    setUploadOpen(false);
    resetForm();
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (!file) throw new Error('Pick a PDF or image of the signed agreement.');
      const totalNum = Number(totalAmount);
      if (!isFinite(totalNum) || totalNum <= 0) {
        throw new Error('Total amount must be a positive number.');
      }
      await uploadServiceAgreement(
        {
          leadId,
          totalAmount: totalNum,
          currency: currency.trim() || 'CAD',
          signedDate: signedDate || undefined,
          notes: notes.trim() || undefined,
        },
        file,
      );
      setSuccess('Agreement uploaded. Finance will set the installment schedule.');
      closeUpload();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(contract: ApiServiceContract) {
    setDownloadingId(contract.id);
    setError(null);
    try {
      const data = await getAgreementDownloadUrl(contract.id);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <GlassCard variant="strong" padded="lg">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div className="sos-eyebrow">Service agreement</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4 }}>
            Signed contract + installment plan
          </h3>
        </div>
        {!uploadOpen ? (
          <PrimaryButton
            size="sm"
            iconLeft={<Upload size={13} />}
            onClick={() => setUploadOpen(true)}
          >
            Upload agreement
          </PrimaryButton>
        ) : null}
      </div>

      {success ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'var(--sos-status-success-soft)',
            border: '1px solid var(--sos-status-success-border)',
            borderRadius: 'var(--sos-radius-sm)',
            fontSize: 13,
            color: 'var(--sos-status-success)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={14} />
          {success}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'var(--sos-status-danger-soft)',
            border: '1px solid var(--sos-status-danger-border)',
            borderRadius: 'var(--sos-radius-sm)',
            fontSize: 13,
            color: 'var(--sos-status-danger)',
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Upload form */}
      {uploadOpen ? (
        <form onSubmit={(e) => void handleUpload(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Agreement file (PDF or image)
            </span>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sos-input"
            />
            {file ? (
              <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            ) : null}
          </label>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Total fee
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                className="sos-input"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Currency
              </span>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={8}
                className="sos-input"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Signed on
              </span>
              <input
                type="date"
                value={signedDate}
                onChange={(e) => setSignedDate(e.target.value)}
                className="sos-input"
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Notes for Finance (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything finance should know (special terms, milestones, etc.)"
              className="sos-input"
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <SecondaryButton type="button" onClick={closeUpload}>
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={submitting}
              iconLeft={submitting ? <Loader2 size={14} className="sos-spin" /> : <Upload size={14} />}
            >
              {submitting ? 'Uploading…' : 'Upload + send to finance'}
            </PrimaryButton>
          </div>
        </form>
      ) : null}

      {/* Existing contracts list */}
      {!uploadOpen ? (
        loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            Loading contracts…
          </div>
        ) : contracts.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--sos-text-muted)',
              background: 'var(--sos-surface-1)',
              borderRadius: 'var(--sos-radius-sm)',
            }}
          >
            <FileSignature size={26} style={{ color: 'var(--sos-text-faint)', marginBottom: 6 }} />
            <div>No signed agreement uploaded yet. Click <strong>Upload agreement</strong> once the client signs.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contracts.map((c) => {
              const isDownloading = downloadingId === c.id;
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 14px',
                    background: 'var(--sos-surface-1)',
                    borderRadius: 'var(--sos-radius-sm)',
                    border: '1px solid var(--sos-border-subtle)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Link
                      href={`/finance/contracts/${c.id}` as Route}
                      style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}
                    >
                      {c.contractNumber}
                    </Link>
                    <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', display: 'flex', gap: 10 }}>
                      <span>{fmtMoney(c.totalAmount, c.currency)}</span>
                      <span>·</span>
                      <span>{c.installments.length} installments</span>
                      {c.signedDate ? (
                        <>
                          <span>·</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={11} /> Signed {fmtDate(c.signedDate)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge tone={statusTone(c.status)} size="sm">{c.status}</StatusBadge>
                    {c.agreementKey ? (
                      <SecondaryButton
                        size="sm"
                        disabled={isDownloading}
                        iconLeft={isDownloading ? <Loader2 size={12} className="sos-spin" /> : <Download size={12} />}
                        onClick={() => void handleDownload(c)}
                      >
                        {isDownloading ? 'Opening…' : 'Download'}
                      </SecondaryButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </GlassCard>
  );
}
