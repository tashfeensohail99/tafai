'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { FileText, AlertTriangle } from 'lucide-react';
import { GlassCard, PageHeader, PrimaryButton } from '@/components/sales-v2/ui';
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
    </div>
  );
}
