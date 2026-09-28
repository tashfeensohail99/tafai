'use client';

import { Component, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { isUploadV2Enabled, uploadV2Mode } from '@/lib/databank-upload/flag';
import { isQueuePresent, subscribePresence } from '@/lib/databank-upload/presence';

/** The dock itself loads only once an upload queue exists in this tab — with
 *  its own loader (not next/dynamic, whose failed load stays failed for the
 *  tab's life), so a chunk that failed to load can be tried again. */
function useDock(): { Dock: ComponentType | null; failed: boolean; retry: () => void } {
  const [Dock, setDock] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const retry = useCallback(() => {
    setFailed(false);
    import('./UploadDock').then(
      (m) => setDock(() => m.default),
      () => setFailed(true),
    );
  }, []);
  return { Dock, failed, retry };
}

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
  const { Dock, failed, retry } = useDock();
  const [attempt, setAttempt] = useState(0);
  const show = uploadV2Mode() !== 'off' && present;
  useEffect(() => {
    if (show && !Dock) retry();
  }, [show, Dock, retry]);
  if (!show) return null;
  const again = () => {
    setAttempt((a) => a + 1);
    retry();
  };
  if (failed) return <DockUnavailable onRetry={again} />;
  if (!Dock) return null;
  return (
    <DockBoundary key={attempt} onRetry={again}>
      <Dock />
    </DockBoundary>
  );
}

/** Neutral: the panel could not be shown — says nothing about the uploads'
 *  state it cannot know (they carry on in the background either way). */
function DockUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="sos-upload-dock sos-upload-dock--pill sos-glass sos-glass--strong" role="status" style={{ padding: '10px 14px', cursor: 'default', display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ flex: 1 }}>The upload panel couldn’t be shown.</span>
      <button type="button" className="sos-btn sos-btn--sm" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** A render error in the dock must not take the whole page down. */
class DockBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <DockUnavailable onRetry={this.props.onRetry} />;
  }
}
