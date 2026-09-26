'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft, Users } from 'lucide-react';
import { DatabankTab } from './tabs/DatabankTab';

/**
 * The SHARED, databank-level "Team folders" area — folders and files tied to no
 * client. Any processing officer or manager (processing.document.upload) can
 * create folders and upload here; every processing user can browse. Reuses the
 * exact explorer from the client databank, in `shared` mode.
 */
export function SharedDatabankView() {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Users size={18} style={{ color: 'var(--sos-accent, #b8860b)' }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary, #0f172a)' }}>Team folders</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--sos-text-muted, #64748b)', marginTop: 4 }}>
          Shared databank folders — not tied to any client. Anyone on the processing team can add folders and files here.
        </div>
      </div>
      <DatabankTab shared />
    </div>
  );
}
