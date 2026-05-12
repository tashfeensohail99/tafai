'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';
import { GlassCard, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  fmtDate,
  fmtRelative,
  getDocumentChecklist,
  getDocumentSignedUrl,
  uploadDocument,
  type PortalDocumentItem,
} from '@/lib/portal';
import { useClientSession } from '@/components/layout/ClientPortalShell';

const DOC_STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: 'Not Uploaded',
  SUBMITTED: 'Uploaded — Pending Review',
  UNDER_REVIEW: 'Under Review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Needs Correction',
  EXPIRED: 'Expired',
  REPLACEMENT_REQUIRED: 'Replacement Required',
  WAIVED: 'Not Required',
  CONDITIONAL_ACCEPT: 'Accepted with Conditions',
};

const DOC_STATUS_TONE: Record<string, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'accent',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'danger',
  REPLACEMENT_REQUIRED: 'warning',
  WAIVED: 'neutral',
  CONDITIONAL_ACCEPT: 'success',
};

const CRITICALITY_LABEL: Record<string, string> = {
  CRITICAL: 'Critical',
  REQUIRED: 'Required',
  CONDITIONAL: 'Conditional',
  SUPPORTING: 'Supporting',
  OPTIONAL: 'Optional',
};

const CRITICALITY_TONE: Record<string, BadgeTone> = {
  CRITICAL: 'danger',
  REQUIRED: 'warning',
  CONDITIONAL: 'info',
  SUPPORTING: 'neutral',
  OPTIONAL: 'neutral',
};

// ---------- Progress bar -------------------------------------------------

function DocProgressBar({ docs }: { docs: PortalDocumentItem[] }) {
  const total = docs.length;
  const accepted = docs.filter((d) => d.status === 'ACCEPTED' || d.status === 'CONDITIONAL_ACCEPT').length;
  const rejected = docs.filter((d) => d.status === 'REJECTED' || d.status === 'REPLACEMENT_REQUIRED').length;
  const pending = docs.filter((d) => d.status === 'SUBMITTED' || d.status === 'UNDER_REVIEW').length;
  const notSubmitted = docs.filter((d) => d.status === 'NOT_SUBMITTED').length;
  const denom = total === 0 ? 1 : total;

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-primary)', fontWeight: 600 }}>
          <CheckCircle2 size={14} style={{ color: 'var(--sos-status-success)' }} />
          {accepted} accepted
        </div>
        {pending > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            <Clock size={14} style={{ color: 'var(--sos-status-info)' }} /> {pending} under review
          </div>
        ) : null}
        {rejected > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            <XCircle size={14} style={{ color: 'var(--sos-status-danger)' }} /> {rejected} need correction
          </div>
        ) : null}
        {notSubmitted > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            <FileText size={14} /> {notSubmitted} not yet uploaded
          </div>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
          {accepted} / {total}
        </span>
      </div>
      <div style={{ display: 'flex', height: '8px', borderRadius: '999px', overflow: 'hidden', background: 'var(--sos-surface-hover)' }}>
        {accepted > 0 ? <div style={{ width: `${(accepted / denom) * 100}%`, background: 'var(--sos-status-success)' }} /> : null}
        {pending > 0 ? <div style={{ width: `${(pending / denom) * 100}%`, background: 'var(--sos-status-info)' }} /> : null}
        {rejected > 0 ? <div style={{ width: `${(rejected / denom) * 100}%`, background: 'var(--sos-status-danger)' }} /> : null}
      </div>
    </GlassCard>
  );
}

// ---------- Upload modal --------------------------------------------------

function UploadModal({
  doc,
  caseId,
  onClose,
  onUploaded,
}: {
  doc: PortalDocumentItem;
  caseId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleFile(f: File) {
    const maxMb = Math.min(doc.maxFileSizeMb, 10);
    if (f.size > maxMb * 1024 * 1024) {
      setError(`File too large. Maximum size is ${maxMb} MB.`);
      return;
    }
    const ext = f.name.split('.').pop()?.toUpperCase() ?? '';
    const accepted = doc.expectedFormats.flatMap((x) => [x, x === 'JPG' ? 'JPEG' : null]).filter(Boolean) as string[];
    if (accepted.length > 0 && !accepted.includes(ext)) {
      setError(`Format not accepted. Please upload: ${doc.expectedFormats.join(', ')}`);
      return;
    }
    setError(null);
    setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(caseId, doc.id, file);
      setDone(true);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <GlassCard variant="strong" padded="lg" style={{ width: '100%', maxWidth: '480px' }}>
        <div id="upload-modal-title" style={{ fontSize: '17px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>
          Upload: {doc.documentName}
        </div>
        <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '16px' }}>
          {doc.description ?? ''}
        </div>

        {doc.latestRejectionMessages.length > 0 ? (
          <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <AlertTriangle size={15} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-primary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong>Correction needed:</strong>
              {doc.latestRejectionMessages.map((r) => (
                <span key={r.code}>{r.clientMessage}</span>
              ))}
            </div>
          </div>
        ) : null}

        {done ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <CheckCircle2 size={40} style={{ color: 'var(--sos-status-success)', marginBottom: '10px' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '6px' }}>Upload received</div>
            <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
              Your officer will review {doc.documentName} shortly.
            </div>
            <button type="button" className="sos-btn sos-btn--primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input-' + doc.id)?.click()}
              style={{
                border: `2px dashed ${dragging ? 'var(--sos-brand-primary-strong)' : file ? 'var(--sos-status-success)' : 'var(--sos-border-subtle)'}`,
                borderRadius: 'var(--sos-radius-md)',
                padding: '28px',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragging ? 'var(--sos-brand-primary-soft)' : file ? 'var(--sos-status-success-soft)' : 'var(--sos-surface-2)',
                transition: 'all 150ms',
                marginBottom: '14px',
              }}
            >
              <input
                id={'file-input-' + doc.id}
                type="file"
                accept={doc.expectedFormats.map((f) => '.' + f.toLowerCase()).join(',')}
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <>
                  <CheckCircle2 size={28} style={{ color: 'var(--sos-status-success)', marginBottom: '6px' }} />
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{file.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB · Click to change
                  </div>
                </>
              ) : (
                <>
                  <Upload size={28} style={{ color: 'var(--sos-text-muted)', marginBottom: '8px' }} />
                  <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>
                    Drag &amp; drop or click to browse
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                    {doc.expectedFormats.join(', ')} · Max {Math.min(doc.maxFileSizeMb, 10)} MB
                  </div>
                </>
              )}
            </div>

            {error ? (
              <div className="sos-banner sos-banner--danger" style={{ marginBottom: 10 }}>{error}</div>
            ) : null}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="sos-btn sos-btn--ghost" onClick={onClose} disabled={uploading}>
                Cancel
              </button>
              <button
                type="button"
                className="sos-btn sos-btn--primary"
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}

// ---------- Document row -------------------------------------------------

function DocumentRow({
  doc,
  caseId,
  onUpload,
}: {
  doc: PortalDocumentItem;
  caseId: string;
  onUpload: (d: PortalDocumentItem) => void;
}) {
  const statusTone = DOC_STATUS_TONE[doc.status] ?? 'neutral';
  const critTone = CRITICALITY_TONE[doc.criticality] ?? 'neutral';
  const [viewing, setViewing] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  async function handleView() {
    if (!doc.latestVersion) return;
    setViewing(true);
    setViewError(null);
    try {
      const { url } = await getDocumentSignedUrl(caseId, doc.id);
      // Signed URL is short-lived; open in a new tab so the client can save
      // or print it without losing the portal page.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setViewError(err instanceof Error ? err.message : 'Could not open document');
    } finally {
      setViewing(false);
    }
  }

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--sos-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '10px', background: 'var(--sos-surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FileText size={17} style={{ color: doc.canUpload ? 'var(--sos-status-warning)' : doc.status === 'ACCEPTED' ? 'var(--sos-status-success)' : 'var(--sos-text-muted)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{doc.documentName}</span>
            <StatusBadge tone={critTone} size="sm">{CRITICALITY_LABEL[doc.criticality]}</StatusBadge>
          </div>
          {doc.description ? (
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '8px' }}>{doc.description}</div>
          ) : null}

          {doc.latestRejectionReasonCodes.length > 0 ? (
            <div style={{ marginBottom: '8px', padding: '8px 12px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '12px', color: 'var(--sos-text-primary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {doc.latestRejectionMessages.map((r) => (
                  <span key={r.code}>{r.clientMessage}</span>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <StatusBadge tone={statusTone} size="sm">{DOC_STATUS_LABEL[doc.status] ?? doc.status}</StatusBadge>
            {doc.latestVersion ? (
              <button
                type="button"
                onClick={() => void handleView()}
                disabled={viewing}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'transparent',
                  border: 'none',
                  padding: '2px 6px',
                  borderRadius: 6,
                  cursor: viewing ? 'wait' : 'pointer',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--sos-brand-primary-strong)',
                  textDecoration: 'underline',
                }}
                title={`View ${doc.latestVersion.fileName}`}
              >
                {viewing ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Eye size={11} />}
                View
              </button>
            ) : null}
            {doc.latestVersion ? (
              <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                {doc.latestVersion.versionNumber > 1 ? `v${doc.latestVersion.versionNumber} · ` : ''}
                Uploaded {fmtRelative(doc.latestVersion.uploadedAt)}
              </span>
            ) : null}
            {doc.validityExpiryDate ? (
              <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                Expires {fmtDate(doc.validityExpiryDate)}
              </span>
            ) : null}
          </div>
          {viewError ? (
            <div className="sos-banner sos-banner--danger" style={{ marginTop: 6, fontSize: 12 }}>
              {viewError}
            </div>
          ) : null}
        </div>

        {doc.canUpload ? (
          <button
            type="button"
            onClick={() => onUpload(doc)}
            className="sos-btn sos-btn--sm sos-btn--primary"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            <Upload size={13} />
            {doc.status === 'REJECTED' ? 'Re-upload' : 'Upload'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Filter logic -------------------------------------------------

type DocFilter = 'ALL' | 'MISSING' | 'REJECTED' | 'EXPIRED' | 'ACCEPTED';

const EXPIRY_WARN_DAYS = 60;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function isExpiredOrExpiring(doc: PortalDocumentItem): boolean {
  const days = daysUntil(doc.validityExpiryDate);
  if (days === null) return false;
  return days <= EXPIRY_WARN_DAYS;
}

function matchesFilter(doc: PortalDocumentItem, filter: DocFilter): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'MISSING':
      return doc.status === 'NOT_SUBMITTED';
    case 'REJECTED':
      return doc.status === 'REJECTED' || doc.status === 'REPLACEMENT_REQUIRED';
    case 'EXPIRED':
      return isExpiredOrExpiring(doc);
    case 'ACCEPTED':
      return doc.status === 'ACCEPTED' || doc.status === 'CONDITIONAL_ACCEPT';
  }
}

function countFor(docs: PortalDocumentItem[], filter: DocFilter): number {
  return docs.filter((d) => matchesFilter(d, filter)).length;
}

// ---------- Tab strip ----------------------------------------------------

function DocFilterTabs({
  docs,
  active,
  onChange,
}: {
  docs: PortalDocumentItem[];
  active: DocFilter;
  onChange: (f: DocFilter) => void;
}) {
  const tabs: Array<{ key: DocFilter; label: string }> = [
    { key: 'ALL', label: 'All' },
    { key: 'MISSING', label: 'Missing' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'EXPIRED', label: 'Expired / Expiring' },
    { key: 'ACCEPTED', label: 'Accepted' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        paddingBottom: 4,
        borderBottom: '1px solid var(--sos-border-subtle)',
      }}
    >
      {tabs.map((t) => {
        const count = countFor(docs, t.key);
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              background: isActive ? 'var(--sos-brand-primary-soft)' : 'transparent',
              color: isActive
                ? 'var(--sos-brand-primary-strong)'
                : 'var(--sos-text-muted)',
              borderBottom: isActive
                ? '2px solid var(--sos-brand-primary)'
                : '2px solid transparent',
              whiteSpace: 'nowrap',
              transition: 'all 150ms',
            }}
          >
            {t.label}
            <span
              style={{
                marginLeft: 6,
                padding: '1px 7px',
                borderRadius: 999,
                background: isActive
                  ? 'var(--sos-brand-primary)'
                  : 'var(--sos-surface-hover)',
                color: isActive ? '#fff' : 'var(--sos-text-muted)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Expiry banner -----------------------------------------------

function ExpiryBanner({ doc }: { doc: PortalDocumentItem }) {
  const days = daysUntil(doc.validityExpiryDate);
  if (days === null) return null;
  if (days > EXPIRY_WARN_DAYS) return null;
  const expired = days < 0;
  return (
    <div
      style={{
        marginBottom: 8,
        padding: '8px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: expired ? 'var(--sos-status-danger-soft)' : 'var(--sos-status-warning-soft)',
        border: `1px solid ${expired ? 'var(--sos-status-danger-border)' : 'var(--sos-status-warning-border)'}`,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        fontSize: 12,
        color: 'var(--sos-text-primary)',
      }}
    >
      <AlertTriangle
        size={14}
        style={{ color: expired ? 'var(--sos-status-danger)' : 'var(--sos-status-warning)', flexShrink: 0, marginTop: 1 }}
      />
      <span>
        {expired
          ? `This document expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. Please upload a renewed copy.`
          : `This document expires in ${days} day${days === 1 ? '' : 's'} (${fmtDate(doc.validityExpiryDate!)}). Please upload a renewed copy before submission.`}
      </span>
    </div>
  );
}

// ---------- Page ---------------------------------------------------------

export function ClientDocumentPage() {
  const { activeCase, refreshCases } = useClientSession();
  const [docs, setDocs] = useState<PortalDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<PortalDocumentItem | null>(null);
  const [filter, setFilter] = useState<DocFilter>('ALL');

  const load = useCallback(async () => {
    if (!activeCase) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getDocumentChecklist(activeCase.id);
      setDocs(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [activeCase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeCase) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div className="sos-text-muted" style={{ textAlign: 'center', padding: 24 }}>
          No active case yet — nothing to upload.
        </div>
      </GlassCard>
    );
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading documents…</div>;
  }
  if (error) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>;
  }

  const filtered = docs.filter((d) => matchesFilter(d, filter));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0, marginBottom: '4px' }}>
          Documents
        </h1>
        <div style={{ fontSize: '13.5px', color: 'var(--sos-text-muted)' }}>
          Upload and track the status of all required documents
        </div>
      </div>

      <DocProgressBar docs={docs} />

      <DocFilterTabs docs={docs} active={filter} onChange={setFilter} />

      <GlassCard variant="panel" padded="md">
        {filtered.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 12, fontSize: 13, textAlign: 'center' }}>
            {filter === 'MISSING'
              ? 'No missing documents — every required item has been uploaded.'
              : filter === 'REJECTED'
                ? 'No documents need correction right now.'
                : filter === 'EXPIRED'
                  ? 'No documents are expired or expiring within 60 days.'
                  : filter === 'ACCEPTED'
                    ? 'No documents have been accepted yet.'
                    : 'No documents yet. Your officer will add the checklist shortly.'}
          </div>
        ) : (
          filtered.map((doc) => (
            <div key={doc.id}>
              {filter === 'EXPIRED' || isExpiredOrExpiring(doc) ? <ExpiryBanner doc={doc} /> : null}
              <DocumentRow doc={doc} caseId={activeCase.id} onUpload={setUploadTarget} />
            </div>
          ))
        )}
      </GlassCard>

      {uploadTarget ? (
        <UploadModal
          doc={uploadTarget}
          caseId={activeCase.id}
          onClose={() => setUploadTarget(null)}
          onUploaded={() => {
            void load();
            void refreshCases();
          }}
        />
      ) : null}
    </div>
  );
}
