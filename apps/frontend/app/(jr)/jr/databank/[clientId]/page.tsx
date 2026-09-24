'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronLeft, Database } from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import { JrDatabankTab } from '@/components/jr/JrDatabankTab';

/**
 * Per-client JR Databank explorer on its own route — the SAME JrDatabankTab used
 * inside a matter. Reached from the databank landing; the client name rides in
 * as ?name= for the header. Access is enforced server-side (the tab just calls
 * the JR databank API for this client).
 */
export default function JrDatabankClientRoute() {
  const params = useParams<{ clientId: string }>();
  const search = useSearchParams();
  const clientId = params.clientId;
  const name = search.get('name') ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Link
        href={'/jr/databank' as Route}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--sos-brand-primary-strong)',
          textDecoration: 'none',
        }}
      >
        <ChevronLeft size={16} /> All clients
      </Link>
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Database size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            {name || 'Client databank'}
          </div>
        </div>
        <JrDatabankTab clientId={clientId} clientName={name || undefined} />
      </GlassCard>
    </div>
  );
}
