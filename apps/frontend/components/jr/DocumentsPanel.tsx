'use client';

import { useRef, useState } from 'react';
import {
  FileText,
  Download,
  Upload,
  Plus,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  GlassCard,
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
  EmptyState,
  FormInput,
  FormSelect,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { ApiClientError } from '@/lib/api-client';
import {
  createJrArtifact,
  uploadJrArtifactVersion,
  fetchJrArtifactVersionUrl,
  jrArtifactInternalQa,
  jrSubmitArtifactToCounsel,
  jrHumanize,
  jrFmtDate,
  JR_ARTIFACT_FOLDER_OPTIONS,
  JR_ARTIFACT_TYPE_OPTIONS,
  type JrArtifactsGrouped,
  type JrArtifactSummary,
} from '@/lib/jr';

const ACCEPTED_FILES = '.pdf,.doc,.docx,image/jpeg,image/png,image/tiff';

/** Local copy of the page's artifact-status → badge-tone mapping. */
function artifactStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'COUNSEL_APPROVED':
    case 'FILED':
    case 'SERVED':
      return 'success';
    case 'COUNSEL_REVIEW':
      return 'info';
    case 'COUNSEL_CHANGES_REQUESTED':
      return 'warning';
    case 'SUPERSEDED':
      return 'neutral';
    case 'INTERNAL_QA':
      return 'accent';
    case 'DRAFT':
    default:
      return 'neutral';
  }
}

function errMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

// ---------------------------------------------------------------------------
// Add-document inline form
// ---------------------------------------------------------------------------
function AddDocumentForm({
  matterId,
  onDone,
  onCancel,
}: {
  matterId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [folder, setFolder] = useState(JR_ARTIFACT_FOLDER_OPTIONS[0].value);
  const [artifactType, setArtifactType] = useState(JR_ARTIFACT_TYPE_OPTIONS[0].value);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError('A title is required.');
      return;
    }
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createJrArtifact(matterId, { artifactType, folder, title: trimmed });
      await uploadJrArtifactVersion(created.id, file, 'Initial version', file.name);
      onDone();
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 14,
        borderRadius: 'var(--sos-radius-md)',
        background: 'var(--sos-surface-2)',
        border: '1px solid var(--sos-border-subtle)',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormSelect
          label="Folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          options={JR_ARTIFACT_FOLDER_OPTIONS}
        />
        <FormSelect
          label="Document type"
          value={artifactType}
          onChange={(e) => setArtifactType(e.target.value)}
          options={JR_ARTIFACT_TYPE_OPTIONS}
        />
      </div>
      <FormInput
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
        required
        placeholder="e.g. Applicant's affidavit (sworn)"
      />
      <div>
        <label className="sos-label">File</label>
        <input
          type="file"
          className="sos-input"
          accept={ACCEPTED_FILES}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ paddingTop: 7 }}
        />
      </div>

      {error ? (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--sos-status-danger-soft)',
            border: '1px solid var(--sos-status-danger-border)',
            color: 'var(--sos-status-danger)',
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <SecondaryButton type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          type="submit"
          disabled={saving}
          iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <Upload size={14} />}
        >
          {saving ? 'Uploading…' : 'Add document'}
        </PrimaryButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Single artifact row
// ---------------------------------------------------------------------------
function ArtifactRow({
  artifact,
  canAuthor,
  canSubmit,
  onChanged,
}: {
  artifact: JrArtifactSummary;
  canAuthor: boolean;
  canSubmit: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const newVersionInputRef = useRef<HTMLInputElement | null>(null);

  const versions = artifact.versions ?? [];
  const currentVersion = artifact.currentVersionId
    ? versions.find((v) => v.id === artifact.currentVersionId)
    : undefined;

  async function openVersion(versionId: string) {
    setError(null);
    try {
      const { url } = await fetchJrArtifactVersionUrl(artifact.id, versionId);
      window.open(url, '_blank', 'noopener');
    } catch (e: unknown) {
      setError(errMessage(e));
    }
  }

  async function onNewVersion(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadJrArtifactVersion(artifact.id, file, undefined, file.name);
      onChanged();
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycle(fn: (id: string) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn(artifact.id);
      onChanged();
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-md)',
        background: 'var(--sos-surface-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            flex: 1,
            minWidth: 160,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--sos-text-primary)',
          }}
        >
          {artifact.title}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: 'var(--sos-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '2px 8px',
            borderRadius: 999,
            background: 'var(--sos-surface-3, rgba(255,255,255,0.04))',
            border: '1px solid var(--sos-border-subtle)',
          }}
        >
          {jrHumanize(artifact.artifactType)}
        </span>
        {currentVersion ? (
          <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
            v{currentVersion.versionNumber} · {currentVersion.fileName}
          </span>
        ) : null}
        <StatusBadge tone={artifactStatusTone(artifact.status)} size="sm" dot={false}>
          {jrHumanize(artifact.status)}
        </StatusBadge>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SecondaryButton
          size="sm"
          type="button"
          disabled={!artifact.currentVersionId || busy}
          onClick={() => artifact.currentVersionId && openVersion(artifact.currentVersionId)}
          iconLeft={<Download size={13} />}
        >
          {artifact.currentVersionId ? 'Download' : 'No file yet'}
        </SecondaryButton>

        {canAuthor ? (
          <>
            <input
              ref={newVersionInputRef}
              type="file"
              accept={ACCEPTED_FILES}
              style={{ display: 'none' }}
              onChange={onNewVersion}
            />
            <SecondaryButton
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => newVersionInputRef.current?.click()}
              iconLeft={busy ? <Loader2 size={13} className="sos-spin" /> : <Upload size={13} />}
            >
              New version
            </SecondaryButton>
          </>
        ) : null}

        {versions.length > 1 ? (
          <SecondaryButton
            size="sm"
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            iconLeft={showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          >
            {versions.length} versions
          </SecondaryButton>
        ) : null}

        {artifact.status === 'DRAFT' && canAuthor ? (
          <SecondaryButton
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => runLifecycle(jrArtifactInternalQa)}
          >
            Move to Internal QA
          </SecondaryButton>
        ) : null}

        {artifact.status === 'INTERNAL_QA' && canSubmit ? (
          <PrimaryButton
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => runLifecycle(jrSubmitArtifactToCounsel)}
          >
            Submit to counsel
          </PrimaryButton>
        ) : null}
      </div>

      {/* Version history */}
      {showHistory && versions.length > 1 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            paddingTop: 8,
            borderTop: '1px solid var(--sos-border-subtle)',
          }}
        >
          {[...versions]
            .sort((a, b) => b.versionNumber - a.versionNumber)
            .map((v) => (
              <div
                key={v.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 11.5,
                  color: 'var(--sos-text-muted)',
                }}
              >
                <span style={{ fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                  v{v.versionNumber}
                </span>
                <span style={{ flex: 1, minWidth: 120 }}>{v.fileName}</span>
                <span>{jrFmtDate(v.createdAt)}</span>
                {v.changeNote ? <span style={{ fontStyle: 'italic' }}>{v.changeNote}</span> : null}
                <button
                  type="button"
                  onClick={() => openVersion(v.id)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--sos-brand-primary-strong)',
                    fontWeight: 600,
                  }}
                >
                  <Download size={12} /> Download
                </button>
              </div>
            ))}
        </div>
      ) : null}

      {error ? (
        <div style={{ fontSize: 11, color: 'var(--sos-status-danger)' }}>{error}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents panel
// ---------------------------------------------------------------------------
export function DocumentsPanel({
  matterId,
  artifacts,
  canAuthor,
  canSubmit,
  onChanged,
}: {
  matterId: string;
  artifacts: JrArtifactsGrouped;
  canAuthor: boolean;
  canSubmit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <GlassCard variant="panel" padded="md">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            Documents
          </div>
        </div>
        {canAuthor && !adding ? (
          <SecondaryButton type="button" onClick={() => setAdding(true)} iconLeft={<Plus size={14} />}>
            Add document
          </SecondaryButton>
        ) : canAuthor && adding ? (
          <SecondaryButton
            type="button"
            onClick={() => setAdding(false)}
            iconLeft={<X size={14} />}
          >
            Cancel
          </SecondaryButton>
        ) : null}
      </div>

      {canAuthor && adding ? (
        <AddDocumentForm
          matterId={matterId}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : null}

      {artifacts.folders.length === 0 ? (
        <EmptyState
          Icon={FileText}
          title="No documents yet"
          description="Add a document to start building the file."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {artifacts.folders.map((folder) => (
            <div key={folder.folder}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--sos-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 8,
                }}
              >
                {jrHumanize(folder.folder)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {folder.artifacts.map((a) => (
                  <ArtifactRow
                    key={a.id}
                    artifact={a}
                    canAuthor={canAuthor}
                    canSubmit={canSubmit}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
