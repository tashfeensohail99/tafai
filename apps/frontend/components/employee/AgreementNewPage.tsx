'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { FileText, AlertTriangle } from 'lucide-react';
import { GlassCard, PageHeader, PrimaryButton } from '@/components/sales-v2/ui';
import { ApiClientError } from '@/lib/api-client';
import {
  createAgreement,
  listTemplateOptions,
  type TemplateOption,
} from '@/lib/agreements';

/**
 * Step 1 of Sales authoring: pick the visa/service category (template). On
 * select we create the draft (bio auto-filled from the lead, plan seeded)
 * and jump to the editor. Requires ?leadId — reached from the lead profile.
 */
export function AgreementNewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const leadId = params.get('leadId') ?? '';

  const [options, setOptions] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Modal shown when the backend rejects with 409 because a same-category
  // agreement already exists on this lead. One-click jump to the existing one.
  const [dupMatch, setDupMatch] = useState<{
    agreementId: string;
    agreementNumber: string;
    status: string;
    categoryKey: string;
  } | null>(null);

  useEffect(() => {
    listTemplateOptions()
      .then(setOptions)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load templates'))
      .finally(() => setLoading(false));
  }, []);

  const pick = async (templateId: string) => {
    if (!leadId) {
      setError('Missing lead — open this from a lead profile.');
      return;
    }
    setCreating(templateId);
    setError(null);
    try {
      const created = await createAgreement({ leadId, templateId });
      router.push(`/sales/agreements/${created.id}` as Route);
    } catch (e) {
      // 409 with a structured `match` = duplicate-category on this lead. Offer
      // "Open existing" instead of a red banner the rep can't act on.
      if (e instanceof ApiClientError && e.status === 409) {
        const details = e.details as
          | {
              reason?: string;
              match?: {
                agreementId?: string;
                agreementNumber?: string;
                status?: string;
                categoryKey?: string;
              };
            }
          | null
          | undefined;
        const m = details?.match;
        if (m?.agreementId && m.agreementNumber && m.status && m.categoryKey) {
          setDupMatch({
            agreementId: m.agreementId,
            agreementNumber: m.agreementNumber,
            status: m.status,
            categoryKey: m.categoryKey,
          });
          setCreating(null);
          return;
        }
      }
      setError(e instanceof Error ? e.message : 'Could not create agreement');
      setCreating(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Agreements"
        title="New agreement"
        description="Choose the visa / service category. The draft is created with the applicant's details auto-filled — you'll set the payment plan next."
      />

      {!leadId ? (
        <div className="sos-banner sos-banner--warning" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={16} /> No lead selected. Open “Create Agreement” from a lead’s profile.
        </div>
      ) : null}
      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Loading templates…</div>
      ) : options.length === 0 ? (
        <GlassCard variant="default">
          <div className="sos-text-muted" style={{ textAlign: 'center', padding: 16 }}>
            No active agreement templates yet. Ask an admin to add them under Settings → Agreement Templates.
          </div>
        </GlassCard>
      ) : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {options.map((t) => (
            <GlassCard key={t.id} variant="default">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} className="sos-text-faint" />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--sos-text-primary)' }}>{t.name}</span>
                </div>
                <div className="sos-text-faint" style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.categoryKey}</div>
                <div className="sos-text-muted" style={{ fontSize: 12.5, flex: 1 }}>{t.programTitle}</div>
                <PrimaryButton
                  size="sm"
                  fullWidth
                  disabled={!leadId || creating !== null}
                  onClick={() => void pick(t.id)}
                >
                  {creating === t.id ? 'Creating…' : 'Use this template'}
                </PrimaryButton>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {dupMatch ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
          onClick={() => setDupMatch(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--sos-bg-elevated, #fff)',
              borderRadius: 12,
              padding: 20,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <AlertTriangle size={22} style={{ color: '#d97706' }} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Agreement already exists</h3>
            </div>
            <p style={{ margin: '0 0 8px 0', fontSize: 13.5, lineHeight: 1.5 }}>
              This lead already has a <strong>{dupMatch.categoryKey}</strong> agreement:
            </p>
            <div
              style={{
                background: 'var(--sos-bg-subtle, #f5f5f7)',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 12,
                fontFamily: 'monospace',
              }}
            >
              {dupMatch.agreementNumber} — {dupMatch.status}
            </div>
            <p className="sos-text-muted" style={{ margin: '0 0 16px 0', fontSize: 12.5, lineHeight: 1.5 }}>
              Open and edit the existing draft instead of creating a new one. Create a
              separate agreement only if it is for a different service or a genuinely
              different applicant.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setDupMatch(null)}
                style={{
                  padding: '8px 14px',
                  border: '1px solid var(--sos-border, #d0d0d0)',
                  background: 'transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <PrimaryButton
                size="sm"
                onClick={() =>
                  router.push(`/sales/agreements/${dupMatch.agreementId}` as Route)
                }
              >
                Open existing agreement
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
