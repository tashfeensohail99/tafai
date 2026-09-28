'use client';

import dynamic from 'next/dynamic';
import { Component, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { isUploadV2Enabled, uploadV2Mode } from '@/lib/databank-upload/flag';
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
  // The pilot opt-in (?uploadV2=1 / =0) is remembered from ANY page, not only
  // the databank explorer.
  useEffect(() => {
    isUploadV2Enabled();
  }, []);
  if (uploadV2Mode() === 'off' || !present) return null;
  return (
    <DockBoundary>
      <UploadDock />
    </DockBoundary>
  );
}

/** The dock chunk failing to load (a network blip at that moment) must not take
 *  the whole page down — the uploads themselves keep running. */
class DockBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="sos-upload-dock sos-upload-dock--pill sos-glass sos-glass--strong" role="status" style={{ padding: '10px 14px', cursor: 'default' }}>
        Uploads are running in the background — keep this tab open.
      </div>
    );
  }
}
