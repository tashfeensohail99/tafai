'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getConsultPayInfo,
  uploadConsultProof,
  type ConsultPayInfo,
} from '@/lib/public-consult-pay';

const NAVY = '#0f2a4a';
const BG = '#f4f6fb';

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString()}`;
}

export default function ConsultPayPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params?.token) ? params.token[0] : params?.token ?? '';

  const [info, setInfo] = useState<ConsultPayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    getConsultPayInfo(token)
      .then((i) => setInfo(i))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (!file) return;
    setSubmitting(true);
    setUploadError(null);
    try {
      await uploadConsultProof(token, file);
      setDone(true);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyHandled =
    info && info.status !== 'PENDING_REVIEW' && info.status !== 'AWAITING_PROOF';

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em' }}>Tashfeen Immigration</div>
          <div style={{ fontSize: 13, color: '#5b6b82', marginTop: 2 }}>Consultation payment</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 24px rgba(15,42,74,0.08)', padding: 20 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#5b6b82', padding: '30px 0' }}>Loading…</div>
          ) : loadError ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🔗</div>
              <div style={{ fontWeight: 700, color: NAVY, marginBottom: 6 }}>Link expired</div>
              <div style={{ fontSize: 13.5, color: '#5b6b82' }}>{loadError} Please ask the front desk for a fresh link.</div>
            </div>
          ) : done ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Receipt received</div>
              <div style={{ fontSize: 14, color: '#5b6b82', lineHeight: 1.5 }}>
                Thank you. Our team is verifying your payment and will confirm your consultation shortly.
              </div>
            </div>
          ) : alreadyHandled ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>{info?.status === 'REJECTED' ? '⚠️' : '✅'}</div>
              <div style={{ fontWeight: 700, color: NAVY, marginBottom: 6 }}>
                {info?.status === 'REJECTED' ? 'Payment not verified' : 'Already confirmed'}
              </div>
              <div style={{ fontSize: 13.5, color: '#5b6b82' }}>
                {info?.status === 'REJECTED'
                  ? 'Please check with the front desk.'
                  : 'This consultation payment has already been handled — no upload needed.'}
              </div>
            </div>
          ) : info ? (
            <>
              {/* Amount */}
              <div style={{ textAlign: 'center', paddingBottom: 14, borderBottom: '1px solid #eef1f6' }}>
                <div style={{ fontSize: 12.5, color: '#5b6b82', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount to transfer</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: NAVY, marginTop: 4 }}>{money(info.currency, info.amount)}</div>
              </div>

              {/* Bank details */}
              {info.bank.iban ? (
                <div style={{ padding: '14px 0', borderBottom: '1px solid #eef1f6' }}>
                  <div style={{ fontSize: 12, color: '#5b6b82', marginBottom: 6 }}>Transfer to</div>
                  {info.bank.name ? <div style={{ fontWeight: 700, color: NAVY }}>{info.bank.name}</div> : null}
                  {info.bank.title ? <div style={{ fontSize: 14, color: '#33465f' }}>{info.bank.title}</div> : null}
                  <div style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', color: NAVY, marginTop: 4, wordBreak: 'break-all' }}>{info.bank.iban}</div>
                </div>
              ) : null}

              {/* Upload */}
              <div style={{ paddingTop: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 10 }}>
                  Upload your transfer receipt or screenshot
                </div>

                {preview ? (
                  <div style={{ marginBottom: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt="Receipt preview" style={{ width: '100%', borderRadius: 12, border: '1px solid #e2e7f0', maxHeight: 320, objectFit: 'contain', background: '#fafbfd' }} />
                    <button
                      type="button"
                      onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                      style={{ marginTop: 8, background: 'transparent', border: 'none', color: '#5b6b82', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      Choose a different image
                    </button>
                  </div>
                ) : (
                  <label
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '28px 16px', border: '2px dashed #c7d2e4', borderRadius: 12,
                      color: '#5b6b82', cursor: 'pointer', textAlign: 'center', background: '#fafbfd',
                    }}
                  >
                    <span style={{ fontSize: 30 }}>📸</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>Tap to take a photo or choose an image</span>
                    <span style={{ fontSize: 12 }}>JPG or PNG</span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      style={{ display: 'none' }}
                    />
                  </label>
                )}

                {uploadError ? (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#b42318', background: '#fef3f2', border: '1px solid #fecdca', borderRadius: 8, padding: '8px 10px' }}>
                    {uploadError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!file || submitting}
                  style={{
                    marginTop: 14, width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
                    background: !file || submitting ? '#9fb0c9' : NAVY, color: '#fff', fontSize: 15, fontWeight: 700,
                    cursor: !file || submitting ? 'default' : 'pointer',
                  }}
                >
                  {submitting ? 'Uploading…' : 'Send receipt'}
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11.5, color: '#8494a8' }}>
          Your receipt is sent securely to our finance team for verification.
        </div>
      </div>
    </div>
  );
}
