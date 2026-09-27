'use client';

import type { ComponentProps } from 'react';
import { DatabankTab } from '../processing/tabs/DatabankTab';
import { jrDatabankApi } from '@/lib/databank-api';

/**
 * The JR databank explorer — the SAME explorer the Processing team uses,
 * pointed at the /jr/databank API (JR permissions: jr.portal.view read,
 * jr.artifact.author write). The store is shared: a JR matter's clientId is the
 * same client the Processing case belongs to, so an escalated client's
 * application documents surface here. Every feature lives in DatabankTab; this
 * wrapper only picks the portal.
 */
export function JrDatabankTab(props: Omit<ComponentProps<typeof DatabankTab>, 'api'>) {
  return <DatabankTab {...props} api={jrDatabankApi} />;
}
