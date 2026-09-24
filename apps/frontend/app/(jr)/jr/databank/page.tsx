'use client';

import { PageHeader } from '@/components/sales-v2/ui';
import { JrDatabankClientsPage } from '@/components/jr/JrDatabankClientsPage';

/**
 * JR Databank landing — an associate-organised browser onto the SAME per-client
 * document store the Processing team uses, scoped to clients with a JR matter.
 * The JrShell already gates this route on jr.portal.view.
 */
export default function JrDatabankRoute() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Documents"
        title="Databank"
        description="Client document repository for your judicial-review matters — browse, upload, rename, move and organise files."
      />
      <JrDatabankClientsPage />
    </div>
  );
}
