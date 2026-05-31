'use client';
// Attestation Plan (Phase 4c-1) — a consolidated, up-front view of which of a
// case's documents must be attested, by which authority, and in what order.
// Shown on BOTH the client portal and the associate workspace so the client
// knows what to arrange *before* uploading. Read-only / informational. No
// timelines (they vary); we just say "start early".

import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { GlassCard, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';

export interface AttestationPlanItem {
  id: string;
  documentName: string;
  /** NOT_REQUIRED | REQUIRED_PENDING | DONE | WAIVED */
  attestationStatus?: string | null;
  /** e.g. "HEC->MOFA" */
  attestationChain?: string | null;
}

// What each authority does — surfaced as a tooltip + legend. No time estimates.
const AUTHORITY: Record<string, { label: string; what: string }> = {
  HEC: { label: 'HEC', what: 'Higher Education Commission — verifies university degrees & transcripts' },
  IBCC: { label: 'IBCC', what: 'Inter Board Committee — attests Matric & Intermediate certificates' },
  NADRA: { label: 'NADRA', what: 'Attests civil records — birth, marriage, family registration, CNIC' },
  NOTARY: { label: 'Notary', what: 'Notarisation before MOFA (experience letters, affidavits)' },
  CHAMBER: { label: 'Chamber of Commerce', what: 'Attests commercial / business documents before MOFA' },
  MOFA: { label: 'MOFA', what: 'Ministry of Foreign Affairs — the central step; needs the domestic attestation done first' },
  APOSTILLE: { label: 'Apostille', what: 'Hague Apostille (issued by MOFA) — for Apostille-Convention countries' },
  EMBASSY: { label: 'Embassy', what: 'Destination-country embassy attestation (where apostille is not used)' },
};

function authority(token: string): { label: string; what: string } {
  const key = token.trim().toUpperCase();
  return AUTHORITY[key] ?? { label: token.trim(), what: '' };
}

function parseChain(chain: string | null | undefined): string[] {
  if (!chain) return [];
  return chain
    .split(/->|→|,|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  REQUIRED_PENDING: { tone: 'warning', label: 'attestation pending' },
  DONE: { tone: 'success', label: 'attested' },
  WAIVED: { tone: 'neutral', label: 'waived' },
};

export function AttestationPlanPanel({
  items,
  audience,
  defaultOpen = true,
}: {
  items: AttestationPlanItem[];
  audience: 'client' | 'associate';
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const required = items.filter(
    (i) => (i.attestationStatus ?? 'NOT_REQUIRED') !== 'NOT_REQUIRED',
  );
  const pending = required.filter((i) => i.attestationStatus === 'REQUIRED_PENDING').length;

  // Authorities actually referenced across this case (for the legend).
  const usedAuthorities = new Set<string>();
  required.forEach((i) => parseChain(i.attestationChain).forEach((t) => usedAuthorities.add(t.toUpperCase())));

  if (required.length === 0) {
    return (
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
          <ShieldCheck size={15} style={{ color: 'var(--sos-text-secondary)' }} />
          No documents for this service require attestation.
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard variant="panel" padded="md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0,
          background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sos-text-primary)',
        }}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <ShieldCheck size={15} style={{ color: 'var(--sos-accent-primary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Attestation plan</span>
        {pending > 0 ? (
          <StatusBadge tone="warning" size="sm">{pending} pending</StatusBadge>
        ) : (
          <StatusBadge tone="success" size="sm">all attested</StatusBadge>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>
          {required.length} document{required.length === 1 ? '' : 's'} need attestation
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary)', lineHeight: 1.5 }}>
            {audience === 'client'
              ? 'These documents must be attested by the relevant authority before you upload them. Please arrange these early — attestation can take time.'
              : 'Documents that must be attested before they can be accepted for this case.'}
          </div>

          {required.map((i) => {
            const steps = parseChain(i.attestationChain);
            const st = STATUS[i.attestationStatus ?? ''] ?? null;
            const done = i.attestationStatus === 'DONE' || i.attestationStatus === 'WAIVED';
            return (
              <div
                key={i.id}
                style={{
                  padding: '8px 10px', borderRadius: 'var(--sos-radius-md)',
                  border: '1px solid var(--sos-border-subtle)',
                  borderLeft: `3px solid ${done ? 'var(--sos-status-success)' : 'var(--sos-status-warning)'}`,
                  background: 'var(--sos-surface-hover)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: steps.length ? 6 : 0 }}>
                  {done ? (
                    <CheckCircle2 size={13} style={{ color: 'var(--sos-status-success)' }} />
                  ) : (
                    <Clock size={13} style={{ color: 'var(--sos-status-warning)' }} />
                  )}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{i.documentName}</span>
                  {st ? <StatusBadge tone={st.tone} size="sm">{st.label}</StatusBadge> : null}
                </div>
                {steps.length ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 21 }}>
                    {steps.map((tok, idx) => {
                      const a = authority(tok);
                      return (
                        <span key={`${i.id}-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {idx > 0 ? <ArrowRight size={12} style={{ color: 'var(--sos-text-muted)' }} /> : null}
                          <span
                            title={a.what}
                            style={{
                              padding: '2px 8px', borderRadius: 'var(--sos-radius-sm)', fontSize: 11.5, fontWeight: 600,
                              border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)',
                              color: 'var(--sos-text-secondary)',
                            }}
                          >
                            {a.label}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Authority legend — only the ones used on this case */}
          {usedAuthorities.size ? (
            <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', lineHeight: 1.6, paddingTop: 4, borderTop: '1px solid var(--sos-border-subtle)' }}>
              {Array.from(usedAuthorities)
                .filter((k) => AUTHORITY[k])
                .map((k) => (
                  <div key={k}><strong style={{ color: 'var(--sos-text-secondary)' }}>{AUTHORITY[k].label}</strong> — {AUTHORITY[k].what}</div>
                ))}
            </div>
          ) : null}

          <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', lineHeight: 1.6 }}>
            Certified <strong>translation</strong> is a separate step from attestation (needed for documents not in
            English or French). The <strong>final step</strong> — destination-country embassy attestation or an
            apostille — {audience === 'client' ? 'will be advised by your case manager.' : 'is advised case-by-case.'}
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}
