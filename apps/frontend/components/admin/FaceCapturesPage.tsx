'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, RefreshCw, X } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import {
  fetchFaceCaptures,
  fetchFaceCaptureImageUrl,
  fetchEnrolledEmployees,
  type FaceCapture,
  type FaceCaptureStatus,
  type EnrolledEmployee,
} from '@/lib/face-attendance';

/**
 * The match threshold the backend uses (FACE_MIN_COSINE). Shown next to each
 * score so a reviewer can see how close a call was, rather than just trusting
 * the badge. Kept in sync with the backend default by hand — it is display-only,
 * nothing here decides a match.
 */
const MATCH_THRESHOLD = 0.4;

const STATUS_TONE: Record<FaceCaptureStatus, BadgeTone> = {
  MATCHED: 'success',
  UNMATCHED: 'neutral',
  PENDING: 'info',
  DUPLICATE: 'info',
  ERROR: 'danger',
};
const STATUS_LABEL: Record<FaceCaptureStatus, string> = {
  MATCHED: 'Matched',
  UNMATCHED: 'Not recognised',
  PENDING: 'Processing',
  DUPLICATE: 'Duplicate',
  ERROR: 'Error',
};

/** ISO timestamp → HH:MM:SS in PKT, or '—'. */
function pktTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Karachi',
  });
}
/** ISO timestamp → DD MMM in PKT, or '—'. */
function pktDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Karachi' });
}

/**
 * One capture thumbnail. The image lives behind an authenticated endpoint, so it
 * is fetched as a blob on mount and the object URL revoked on unmount — leaving
 * these un-revoked leaks the decoded JPEG for the life of the tab, and this list
 * can hold 200 of them.
 */
function CaptureThumb({ capture, onOpen }: { capture: FaceCapture; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!capture.hasImage) return;
    let revoked = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        objectUrl = await fetchFaceCaptureImageUrl(capture.id);
        if (revoked) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setUrl(objectUrl);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [capture.id, capture.hasImage]);

  const box: React.CSSProperties = {
    width: 132,
    height: 74,
    borderRadius: 8,
    border: '1px solid var(--sos-border-subtle)',
    background: 'var(--sos-surface-2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    color: 'var(--sos-text-muted)',
    overflow: 'hidden',
    flexShrink: 0,
  };

  if (!capture.hasImage) return <div style={box}>no image</div>;
  if (failed) return <div style={box}>unavailable</div>;
  if (!url) return <div style={box}><Loader2 size={14} className="sos-spin" /></div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob: URL, next/image cannot optimise it
    <img
      src={url}
      alt={`Capture at ${pktTime(capture.capturedAt)}`}
      onClick={() => onOpen(url)}
      style={{ ...box, objectFit: 'cover', cursor: 'zoom-in' }}
    />
  );
}

export function FaceCapturesPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('employees.view_all');

  const [captures, setCaptures] = useState<FaceCapture[]>([]);
  const [enrolled, setEnrolled] = useState<EnrolledEmployee[]>([]);
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, staff] = await Promise.all([
        fetchFaceCaptures(60, matchedOnly),
        fetchEnrolledEmployees().catch(() => [] as EnrolledEmployee[]),
      ]);
      setCaptures(rows);
      setEnrolled(staff);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load camera captures');
    } finally {
      setLoading(false);
    }
  }, [matchedOnly]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    void load();
  }, [canView, load]);

  // Captures arrive whenever someone walks past, so poll rather than make the
  // reviewer keep hitting refresh. Cleared on unmount so it cannot outlive the page.
  useEffect(() => {
    if (!canView) return;
    autoRef.current = setInterval(() => void load(), 30_000);
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, [canView, load]);

  const summary = useMemo(() => {
    const s = { matched: 0, unmatched: 0, other: 0 };
    for (const c of captures) {
      if (c.status === 'MATCHED') s.matched++;
      else if (c.status === 'UNMATCHED') s.unmatched++;
      else s.other++;
    }
    return s;
  }, [captures]);

  const enrolledCount = useMemo(() => enrolled.filter((e) => e.samples > 0).length, [enrolled]);

  if (!canView) return <PermissionDeniedState />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Camera Captures"
        description="Every face the door camera sent in, newest first — the photo, who it matched and how confident the match was. This is the evidence behind each attendance punch."
        actions={
          <PrimaryButton onClick={() => void load()}>
            <RefreshCw size={15} />
            Refresh
          </PrimaryButton>
        }
      />

      <GlassCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Camera size={16} style={{ color: 'var(--sos-text-muted)' }} />
            <SecondaryButton onClick={() => setMatchedOnly((v) => !v)}>
              {matchedOnly ? 'Showing matched only' : 'Showing all captures'}
            </SecondaryButton>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: 'var(--sos-text-muted)', flexWrap: 'wrap' }}>
            <span>Matched <b style={{ color: 'var(--sos-text-primary)' }}>{summary.matched}</b></span>
            <span>Not recognised <b style={{ color: 'var(--sos-text-primary)' }}>{summary.unmatched}</b></span>
            {summary.other ? <span>Other <b style={{ color: 'var(--sos-text-primary)' }}>{summary.other}</b></span> : null}
            <span>Staff enrolled <b style={{ color: 'var(--sos-text-primary)' }}>{enrolledCount}</b></span>
          </div>
        </div>
      </GlassCard>

      {!loading && !error && enrolledCount === 0 ? (
        <GlassCard>
          <div style={{ padding: 12, color: 'var(--sos-status-warning)', fontSize: 13 }}>
            ⚠️ Nobody has face samples enrolled, so every capture will come back “Not recognised”. Enrol staff
            photos before relying on this.
          </div>
        </GlassCard>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : captures.length === 0 ? (
        <GlassCard>
          <div style={{ padding: 20, fontSize: 13.5, color: 'var(--sos-text-muted)', textAlign: 'center' }}>
            No captures yet. The camera sends a face whenever someone walks past the door.
          </div>
        </GlassCard>
      ) : (
        <GlassCard>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '10px 14px' }}>Photo</th>
                  <th style={{ padding: '10px 14px' }}>Time</th>
                  <th style={{ padding: '10px 14px' }}>Result</th>
                  <th style={{ padding: '10px 14px' }}>Matched to</th>
                  <th style={{ padding: '10px 14px' }}>Confidence</th>
                  <th style={{ padding: '10px 14px' }}>Camera</th>
                </tr>
              </thead>
              <tbody>
                {captures.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <CaptureThumb capture={c} onOpen={setLightbox} />
                    </td>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>{pktTime(c.capturedAt)}</div>
                      <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{pktDate(c.capturedAt)}</div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <StatusBadge tone={STATUS_TONE[c.status] ?? 'neutral'}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </StatusBadge>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--sos-text-primary)' }}>
                      {c.employeeName ?? <span style={{ color: 'var(--sos-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      {c.similarity === null ? (
                        <span style={{ color: 'var(--sos-text-muted)' }}>—</span>
                      ) : (
                        <>
                          <span
                            style={{
                              fontWeight: 600,
                              color:
                                c.similarity >= MATCH_THRESHOLD
                                  ? 'var(--sos-status-success)'
                                  : 'var(--sos-text-muted)',
                            }}
                          >
                            {c.similarity.toFixed(3)}
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                            {' '}/ {MATCH_THRESHOLD} needed
                          </span>
                        </>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--sos-text-muted)' }}>
                      {c.channelId ? `Channel ${c.channelId}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {lightbox ? (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
            cursor: 'zoom-out',
          }}
        >
          <button
            onClick={() => setLightbox(null)}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: 18,
              right: 18,
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <X size={22} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL */}
          <img
            src={lightbox}
            alt="Camera capture, full size"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10 }}
          />
        </div>
      ) : null}
    </div>
  );
}
