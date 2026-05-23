'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { FileText } from 'lucide-react';
import { Modal } from '@/components/whatsapp/Modal';
import {
  createAgreement,
  listTemplateOptions,
  type TemplateOption,
} from '@/lib/agreements';

/**
 * Premium popup for starting an agreement on the lead page (no page change).
 * Lists the active category templates; selecting one creates the draft
 * (bio auto-filled, plan seeded) and opens the editor for the payment plan.
 */
export function CreateAgreementModal({
  open,
  leadId,
  onClose,
}: {
  open: boolean;
  leadId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setCreating(null);
    listTemplateOptions()
      .then(setOptions)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load templates'))
      .finally(() => setLoading(false));
  }, [open]);

  const pick = async (templateId: string) => {
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
    <Modal open={open} title="New agreement" onClose={onClose} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="sos-text-muted" style={{ fontSize: 13, margin: 0 }}>
          Choose the visa / service category. The draft is created with the applicant&apos;s
          details auto-filled — you&apos;ll set the payment plan next.
        </p>

        {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

        {loading ? (
          <div className="sos-text-muted" style={{ padding: 18, textAlign: 'center' }}>
            Loading templates…
          </div>
        ) : options.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 18, textAlign: 'center', fontSize: 13 }}>
            No active templates yet. Add them under Settings → Agreement Templates.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
            {options.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={creating !== null}
                onClick={() => void pick(t.id)}
                className="sos-glass"
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border-subtle)',
                  cursor: creating !== null ? 'default' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  opacity: creating !== null && creating !== t.id ? 0.5 : 1,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5, color: 'var(--sos-text-primary)' }}>
                  <FileText size={16} className="sos-text-faint" /> {t.name}
                </span>
                <span className="sos-text-faint" style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.categoryKey}</span>
                <span className="sos-text-muted" style={{ fontSize: 12 }}>
                  {creating === t.id ? 'Creating…' : t.programTitle}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
