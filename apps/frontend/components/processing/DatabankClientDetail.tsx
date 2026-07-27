'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { DatabankTab } from './tabs/DatabankTab';

/**
 * A client's databank on its own route (cross-client landing → client). Reuses
 * the exact explorer from the case-workspace tab; the client name comes in via
 * `?name=` from the landing link so we don't need an extra fetch just for the
 * header.
 */
export function DatabankClientDetail({ clientId }: { clientId: string }) {
  const params = useSearchParams();
  const name = params.get('name') ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Link
          href={'/processing/databank' as Route}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--sos-text-muted, #64748b)',
            textDecoration: 'none',
          }}
        >
          <ArrowLeft size={14} /> All client databanks
        </Link>
        {name ? (
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary, #0f172a)', marginTop: 8 }}>{name}</div>
        ) : null}
      </div>
      <DatabankTab clientId={clientId} />
    </div>
  );
}
