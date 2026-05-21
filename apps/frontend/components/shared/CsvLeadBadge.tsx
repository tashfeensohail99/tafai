'use client';

import { FileSpreadsheet } from 'lucide-react';

/**
 * Inline tag rendered next to a lead's name (or thread row) when the
 * lead originated from a CSV/Excel upload. Visible in:
 *
 *   /admin/leads                 (table row)
 *   /admin/whatsapp              (thread list)
 *   /sales/csv-leads             (table row)
 *   /sales/inbox                 (thread list)
 *   /sales/leads                 (assigned leads list)
 *   /sales/leads/[id]            (lead profile header)
 *
 * Hover-tip shows the batch label when provided so an operator can tell
 * which campaign / list this contact came from without opening the
 * lead profile.
 */
interface Props {
  /** Optional batch label (e.g. "May FB Ads"). Shown in the tooltip. */
  batchName?: string | null;
  /** Compact = icon-only, used in tight rows. */
  compact?: boolean;
}

export function CsvLeadBadge({ batchName, compact }: Props) {
  const title = batchName ? `CSV lead — batch: ${batchName}` : 'CSV lead';
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '0 4px' : '1px 6px',
        fontSize: compact ? 9.5 : 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: 'var(--sos-brand-primary-soft)',
        color: 'var(--sos-brand-primary-strong)',
        border: '1px solid var(--sos-brand-primary-border)',
        borderRadius: 4,
        verticalAlign: 'middle',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <FileSpreadsheet size={compact ? 9 : 10} />
      {compact ? null : 'CSV LEAD'}
    </span>
  );
}
