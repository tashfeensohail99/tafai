'use client';

import { useEffect, useState } from 'react';
import { fetchSystemAlerts, type SystemAlert } from '@/lib/system-alerts';

/**
 * Global outage banner. Polls /system/alerts every 60s (+ on tab focus) and
 * shows a bar for each active service-health alert — so reps immediately see
 * "WhatsApp sending is down, use calls" instead of silently hitting a dead
 * channel. Renders nothing when everything is healthy, and auto-clears the
 * moment the sentinel marks the incident resolved. Fails closed (hidden) on any
 * fetch error so it can never block the app.
 */
export function SystemAlertBanner() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSystemAlerts()
        .then((a) => { if (alive) setAlerts(Array.isArray(a) ? a : []); })
        .catch(() => { if (alive) setAlerts([]); });
    load();
    const t = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div role="alert" aria-live="polite">
      {alerts.map((a) => {
        const crit = a.severity === 'critical';
        return (
          <div
            key={a.key}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '9px 16px',
              fontSize: 13,
              lineHeight: 1.45,
              background: crit ? 'var(--sos-status-danger-soft)' : 'var(--sos-status-info-soft)',
              color: crit ? 'var(--sos-status-danger)' : 'var(--sos-status-info)',
              borderBottom: `1px solid ${crit ? 'var(--sos-status-danger-border)' : 'var(--sos-status-info-border)'}`,
            }}
          >
            <span aria-hidden style={{ fontSize: 15, flex: '0 0 auto' }}>{crit ? '🔴' : '🟡'}</span>
            <span><strong>{a.title}.</strong> {a.message}</span>
          </div>
        );
      })}
    </div>
  );
}
