'use client';

import { DatabankClientsPage } from '../processing/DatabankClientsPage';
import { jrDatabankApi } from '@/lib/databank-api';

/**
 * JR Databank landing, organised by associate — the SAME landing the
 * Processing team uses, pointed at /jr/databank/clients/by-associate (clients
 * that have a JR matter, grouped by the matter's assigned associate, with an
 * "Unassigned" bucket). Every feature lives in DatabankClientsPage; this
 * wrapper only picks the portal.
 */
export function JrDatabankClientsPage() {
  return <DatabankClientsPage api={jrDatabankApi} />;
}
