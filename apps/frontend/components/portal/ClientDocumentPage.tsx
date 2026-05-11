'use client';
// Client Portal — Document Checklist & Upload page — Phase 1C.
// Client sees all their document items, can upload NOT_SUBMITTED or REJECTED items.
// Client sees rejection notes but NOT internal officer strategy/notes.

import { useState } from 'react';
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
  MOCK_CLIENT_DOCUMENTS,
  type ClientDocumentItem,
  fmtDate,
  fmtRelative,
} from '@/components/portal/clientMockData';

// ---------- Document status helpers --------------------------------------

const DOC_STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: 'Not Uploaded',
  SUBMITTED: 'Uploaded — Pending Review',
  UNDER_REVIEW: 'Under Review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Needs Correction',
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring Soon',
  WAIVED: 'Not Required',
  NOT_APPLICABLE: 'Not Applicable',
};

const DOC_STATUS_TONE: Record<string, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'accent',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'danger',
  EXPIRING_SOON: 'warning',
  WAIVED: 'neutral',
  NOT_APPLICABLE: 'neutral',
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

// ---------- Progress summary bar ----------------------------------------

function DocProgressBar({ docs }: { docs: ClientDocumentItem[] }) {
  const total = docs.length;
  const accepted = docs.filter((d) => d.status === 'ACCEPTED').length;
  const rejected = docs.filter((d) => d.status === 'REJECTED').length;
  const pending = docs.filter((d) => ['SUBMITTED', 'UNDER_REVIEW'].includes(d.status)).length;
  const notSubmitted = docs.filter((d) => d.status === 'NOT_SUBMITTED').length;

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-primary)', fontWeight: 600 }}>
          <CheckCircle2 size={14} style={{ color: 'var(--sos-status-success)' }} />
          {accepted} accepted
        </div>
        {pending > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            <Clock size={14} style={{ color: 'var(--sos-status-info)' }} />
            {pending} under review
          </div>
        ) : null}
        {rejected > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            <XCircle size={14} style={{ color: 'var(--sos-status-danger)' }} />
            {rejected} need correction
          </div>
        ) : null}
        {notSubmitted > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            <FileText size={14} />
            {notSubmitted} not yet uploaded
          </div>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
          {accepted} / {total}
        </span>
      </div>
      {/* Segmented bar */}
      <div style={{ display: 'flex', height: '8px', borderRadius: '999px', overflow: 'hidden', background: 'var(--sos-surface-hover)' }}>
        {accepted > 0 ? (
          <div style={{ width: `${(accepted / total) * 100}%`, background: 'var(--sos-status-success)', transition: 'width 400ms' }} />
        ) : null}
        {pending > 0 ? (
          <div style={{ width: `${(pending / total) * 100}%`, background: 'var(--sos-status-info)', transition: 'width 400ms' }} />
        ) : null}
        {rejected > 0 ? (
          <div style={{ width: `${(rejected / total) * 100}%`, background: 'var(--sos-status-danger)', transition: 'width 400ms' }} />
        ) : null}
      </div>
    </GlassCard>
  );
}

// ---------- Upload modal (mock) -----------------------------------------

function UploadModal({ doc, onClose }: { doc: ClientDocumentItem; onClose: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  function handleFile(f: File) {
    const maxMb = 10;
    if (f.size > maxMb * 1024 * 1024) {
      alert(`File too large. Maximum size is ${maxMb} MB.`);
      return;
    }
    const ext = f.name.split('.').pop()?.toUpperCase() ?? '';
    const accepted = doc.expectedFormats.flatMap((x) => [x, x === 'JPG' ? 'JPEG' : null]).filter(Boolean) as string[];
    if (!accepted.includes(ext)) {
      alert(`Format not accepted. Please upload: ${doc.expectedFormats.join(', ')}`);
      return;
    }
    setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleUpload() {
    if (!file) return;
    setUploading(true);
    // NOTE: In production, call:
    // POST /processing/cases/:caseId/documents/:itemId/upload
    // with multipart form data. The backend issues a signed PUT URL via S3-compatible storage.
    // This mock just simulates the delay.
    setTimeout(() => {
      setUploading(false);
      setDone(true);
    }, 1200);
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
          {doc.description}
        </div>

        {doc.rejectionNote ? (
          <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <AlertTriangle size={15} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-primary)' }}>
              <strong>Correction needed:</strong> {doc.rejectionNote}
            </div>
          </div>
        ) : null}

        {done ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <CheckCircle2 size={40} style={{ color: 'var(--sos-status-success)', marginBottom: '10px' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '6px' }}>Upload received</div>
            <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>Your officer will review {doc.documentName} shortly.</div>
            <button
              type="button"
              className="sos-btn sos-btn--primary"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Drop zone */}
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
                  <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{(file.size / 1024 / 1024).toFixed(1)} MB · Click to change</div>
                </>
              ) : (
                <>
                  <Upload size={28} style={{ color: 'var(--sos-text-muted)', marginBottom: '8px' }} />
                  <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>Drag &amp; drop or click to browse</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                    {doc.expectedFormats.join(', ')} · Max 10 MB
                  </div>
                </>
              )}
            </div>

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

function DocumentRow({ doc, onUpload }: { doc: ClientDocumentItem; onUpload: (d: ClientDocumentItem) => void }) {
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
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {doc.documentName}
            </span>
            <StatusBadge tone={critTone} size="sm">{CRITICALITY_LABEL[doc.criticality]}</StatusBadge>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '8px' }}>{doc.description}</div>

          {doc.rejectionNote ? (
            <div style={{ marginBottom: '8px', padding: '8px 12px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '12px', color: 'var(--sos-text-primary)' }}>{doc.rejectionNote}</div>
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <StatusBadge tone={statusTone} size="sm">{DOC_STATUS_LABEL[doc.status] ?? doc.status}</StatusBadge>
            {doc.uploadedAt ? (
              <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                {doc.versionNumber > 1 ? `v${doc.versionNumber} · ` : ''}
                Uploaded {fmtRelative(doc.uploadedAt)}
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

// ---------- Client Documents page ----------------------------------------

export function ClientDocumentPage() {
  const [uploadTarget, setUploadTarget] = useState<ClientDocumentItem | null>(null);

  const actionRequired = MOCK_CLIENT_DOCUMENTS.filter((d) => d.canUpload);
  const notActionRequired = MOCK_CLIENT_DOCUMENTS.filter((d) => !d.canUpload);

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

      <DocProgressBar docs={MOCK_CLIENT_DOCUMENTS} />

      {/* Action required section */}
      {actionRequired.length > 0 ? (
        <GlassCard variant="soft" padded="md" style={{ borderLeft: '3px solid var(--sos-status-warning)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-status-warning)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
            Action Required
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '8px' }}>
            {actionRequired.length} document{actionRequired.length !== 1 ? 's' : ''} need{actionRequired.length === 1 ? 's' : ''} your attention
          </div>
          {actionRequired.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onUpload={setUploadTarget} />
          ))}
        </GlassCard>
      ) : null}

      {/* All other documents */}
      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
          All documents
        </div>
        {notActionRequired.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} onUpload={setUploadTarget} />
        ))}
      </GlassCard>

      {/* Upload modal */}
      {uploadTarget ? (
        <UploadModal doc={uploadTarget} onClose={() => setUploadTarget(null)} />
      ) : null}
    </div>
  );
}
