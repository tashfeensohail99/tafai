'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Upload,
  XCircle,
} from 'lucide-react';
import { GlassCard, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  fmtDate,
  fmtRelative,
  getDocumentChecklist,
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

        {doc.latestRejectionReasonCodes.length > 0 ? (
          <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <AlertTriangle size={15} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-primary)' }}>
              <strong>Correction needed:</strong> {doc.latestRejectionReasonCodes.join(', ')}
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
  onUpload,
}: {
  doc: PortalDocumentItem;
  onUpload: (d: PortalDocumentItem) => void;
}) {
  const statusTone = DOC_STATUS_TONE[doc.status] ?? 'neutral';
  const critTone = CRITICALITY_TONE[doc.criticality] ?? 'neutral';

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
              <div style={{ fontSize: '12px', color: 'var(--sos-text-primary)' }}>
                Reason: {doc.latestRejectionReasonCodes.join(', ')}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <StatusBadge tone={statusTone} size="sm">{DOC_STATUS_LABEL[doc.status] ?? doc.status}</StatusBadge>
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

// ---------- Page ---------------------------------------------------------

export function ClientDocumentPage() {
  const { activeCase, refreshCases } = useClientSession();
  const [docs, setDocs] = useState<PortalDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<PortalDocumentItem | null>(null);

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

  const actionRequired = docs.filter((d) => d.canUpload);
  const notActionRequired = docs.filter((d) => !d.canUpload);

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

      {actionRequired.length > 0 ? (
        <GlassCard variant="soft" padded="md" style={{ borderLeft: '3px solid var(--sos-status-warning)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-status-warning)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
            Action Required
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '8px' }}>
            {actionRequired.length} document{actionRequired.length !== 1 ? 's' : ''} need
            {actionRequired.length === 1 ? 's' : ''} your attention
          </div>
          {actionRequired.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onUpload={setUploadTarget} />
          ))}
        </GlassCard>
      ) : null}

      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
          All documents
        </div>
        {notActionRequired.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 12, fontSize: 13 }}>
            No documents yet. Your officer will add the checklist shortly.
          </div>
        ) : (
          notActionRequired.map((doc) => <DocumentRow key={doc.id} doc={doc} onUpload={setUploadTarget} />)
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
