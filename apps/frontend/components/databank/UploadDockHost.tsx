'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import { uploadV2Mode } from '@/lib/databank-upload/flag';
import { isQueuePresent, subscribePresence } from '@/lib/databank-upload/presence';

/** The dock itself (and the engine behind it) loads only once an upload
 *  queue exists in this tab. */
const UploadDock = dynamic(() => import('./UploadDock'), { ssr: false });

/**
 * Mounted once in the root layout (like BackendWarmup), so uploads stay
 * visible — and keep running — while the officer moves between pages and
 * portals. Renders nothing unless resumable uploads are enabled for this build
 * AND something has been queued in this tab.
 */
export function UploadDockHost() {
  const present = useSyncExternalStore(subscribePresence, isQueuePresent, () => false);
  if (uploadV2Mode() === 'off' || !present) return null;
  return <UploadDock />;
}
