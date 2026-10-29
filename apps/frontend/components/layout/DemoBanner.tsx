'use client';

import { useRuntimeConfig } from '@/lib/runtime-config';

/**
 * Persistent "demo environment" strip. Mounted in the root layout so it shows
 * on every page, including login. Renders nothing outside DEMO_MODE, so the
 * production build is unaffected.
 */
export function DemoBanner() {
  const cfg = useRuntimeConfig();
  if (!cfg.demoMode) return null;
  return (
    <div
      role="status"
      data-demo-banner
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '7px 16px',
        fontSize: 13,
        lineHeight: 1.4,
        fontWeight: 600,
        background: 'repeating-linear-gradient(135deg, #fde68a 0 14px, #fcd34d 14px 28px)',
        color: '#78350f',
        borderBottom: '1px solid #f59e0b',
      }}
    >
      <span aria-hidden>🧪</span>
      <span>
        Demo environment — sample data. Names, numbers and documents are synthetic; nothing sent here reaches a real customer.
        {cfg.demoLiveLaneEnabled && cfg.demoLiveDisplayNumber ? (
          <>
            {' '}Try the assistant yourself: WhatsApp <strong>{cfg.demoLiveDisplayNumber}</strong>.
          </>
        ) : null}
      </span>
    </div>
  );
}
