'use client';
/**
 * P4e — Submission Package Panel
 *
 * Shown on the processing case workspace when the case is in
 * READY_FOR_SUBMISSION, SUBMITTED, or later stages.
 *
 * - Fetches the existing package (if any) on mount.
 * - Lets the officer assemble (or re-assemble) the merged PDF.
 * - Displays a download link once assembled.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  Loader2,
  PackageCheck,
  RefreshCw,
} from 'lucide-react';
import { GlassCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/sales-v2/ui';
import { assembleSubmissionPackage, getSubmissionPackage } from '@/lib/processing';

// Stages where the panel is relevant
const PACKAGE_RELEVANT_STAGES = new Set([
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'UNDER_AUTHORITY_REVIEW',
  'ADDITIONAL_INFO_REQUESTED',
  'DECISION_RECEIVED',
  'APPROVED',
  'COMPLETED',
]);

interface PackageInfo {
  exists: true;
  key: string;
  fileName: string;
  sizeBytes: number;
  documentCount: number;
  assembledAt: string;
  signedUrl: string;
}

export function SubmissionPackagePanel({
  caseId,
  caseStage,
}: {
  caseId: string;
  caseStage: string;
}) {
  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [assembling, setAssembling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  const loadPackage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSubmissionPackage(caseId);
      if (result.exists) {
        setPkg(result as PackageInfo);
      } else {
        setPkg(null);
      }
    } catch {
      // Not a fatal error — just means no package info available
      setPkg(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (PACKAGE_RELEVANT_STAGES.has(caseStage)) {
      loadPackage();
    }
  }, [caseId, caseStage, loadPackage]);

  async function handleAssemble() {
    setAssembling(true);
    setError(null);
    setBlockers([]);
    try {
      const result = await assembleSubmissionPackage(caseId);
      setPkg({
        exists: true,
        key: result.key,
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
        documentCount: result.documentCount,
        assembledAt: result.assembledAt,
        signedUrl: result.signedUrl,
      });
    } catch (e: unknown) {
      let msg = 'Failed to assemble package';
      let parsedBlockers: string[] = [];
      if (e instanceof Error) {
        try {
          const parsed = JSON.parse(e.message);
          if (parsed?.message) msg = parsed.message;
          if (Array.isArray(parsed?.blockers)) parsedBlockers = parsed.blockers;
        } catch {
          msg = e.message;
        }
      }
      setError(msg);
      setBlockers(parsedBlockers);
    } finally {
      setAssembling(false);
    }
  }

  if (!PACKAGE_RELEVANT_STAGES.has(caseStage)) return null;

  return (
    <GlassCard variant="panel" padded="md">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <PackageCheck size={15} style={{ color: 'var(--sos-accent-primary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
          Submission Package
        </span>
        {pkg ? (
          <StatusBadge tone="success" size="sm" style={{ marginLeft: 'auto' }}>
            assembled
          </StatusBadge>
        ) : loading ? null : (
          <StatusBadge tone="neutral" size="sm" style={{ marginLeft: 'auto' }}>
            not assembled
          </StatusBadge>
        )}
      </div>

      {/* Loading state */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
          <Loader2 size={14} />
          Loading package info…
        </div>
      ) : pkg ? (
        /* Package exists */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            padding: '10px 12px', borderRadius: 'var(--sos-radius-md)',
            background: 'var(--sos-status-success-soft)',
            border: '1px solid var(--sos-status-success-border)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <CheckCircle2 size={14} style={{ color: 'var(--sos-status-success)', flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 12.5 }}>
              <div style={{ fontWeight: 600, color: 'var(--sos-status-success)' }}>
                {pkg.documentCount} document{pkg.documentCount !== 1 ? 's' : ''} merged into one PDF
              </div>
              <div style={{ color: 'var(--sos-text-muted)', marginTop: 2 }}>
                Assembled {new Date(pkg.assembledAt).toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={pkg.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={pkg.fileName}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 'var(--sos-radius-md)',
                background: 'var(--sos-brand-primary-strong)', color: '#fff',
                fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
                border: 'none', cursor: 'pointer',
              }}
            >
              <Download size={13} />
              Download PDF
            </a>
            <button
              type="button"
              onClick={handleAssemble}
              disabled={assembling}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 'var(--sos-radius-md)',
                background: 'transparent', color: 'var(--sos-text-secondary)',
                fontSize: 12.5, fontWeight: 500,
                border: '1px solid var(--sos-border-subtle)', cursor: assembling ? 'default' : 'pointer',
                opacity: assembling ? 0.6 : 1,
              }}
            >
              {assembling ? <Loader2 size={13} /> : <RefreshCw size={13} />}
              {assembling ? 'Assembling…' : 'Re-assemble'}
            </button>
          </div>
        </div>
      ) : (
        /* No package yet */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--sos-text-secondary)', lineHeight: 1.55 }}>
            Merge all accepted documents into a single ordered PDF for authority submission.
            The package includes a branded cover page with the document list.
          </p>

          <button
            type="button"
            onClick={handleAssemble}
            disabled={assembling}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 'var(--sos-radius-md)',
              background: 'var(--sos-brand-primary-strong)', color: '#fff',
              fontSize: 12.5, fontWeight: 600, border: 'none',
              cursor: assembling ? 'default' : 'pointer', opacity: assembling ? 0.7 : 1,
              alignSelf: 'flex-start',
            }}
          >
            {assembling ? <Loader2 size={13} /> : <FileDown size={13} />}
            {assembling ? 'Assembling…' : 'Assemble Package'}
          </button>
        </div>
      )}

      {/* Error / blockers */}
      {error ? (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 'var(--sos-radius-md)',
          background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--sos-status-danger)', marginBottom: blockers.length ? 8 : 0 }}>
            <AlertTriangle size={13} />
            {error}
          </div>
          {blockers.length > 0 ? (
            <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {blockers.map((b, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--sos-text-primary)', lineHeight: 1.5 }}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
