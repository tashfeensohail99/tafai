'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setAccessToken, setRefreshToken } from '@/lib/auth-client';
import { destinationForUser, fetchMe, invalidateSessionCache } from '@/lib/session';
import { invalidateApiCache } from '@/lib/api-client';

/**
 * Landing page for prospect sign-in links: /demo/enter?t=<token>.
 * Redeems the token for a normal session and forwards to the right workspace.
 */
function DemoEnter() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('t') ?? '';
  const [state, setState] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState('Opening your demo workspace…');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        setState('error');
        setMessage('This link is missing its access token.');
        return;
      }
      try {
        const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
        const res = await fetch(`${base}/demo/access/redeem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; message?: string | string[] };
        if (!res.ok || !body.accessToken || !body.refreshToken) {
          const m = Array.isArray(body.message) ? body.message.join(', ') : body.message;
          throw new Error(m || 'This demo link is not valid.');
        }
        setAccessToken(body.accessToken);
        setRefreshToken(body.refreshToken);
        invalidateSessionCache();
        invalidateApiCache();
        const me = await fetchMe();
        if (!alive) return;
        router.replace(destinationForUser(me));
      } catch (err) {
        if (!alive) return;
        setState('error');
        setMessage(err instanceof Error ? err.message : 'This demo link is not valid.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, router]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        fontFamily: 'Manrope, system-ui, sans-serif',
        background: 'var(--sos-bg, #f8fafc)',
        color: 'var(--sos-text-primary, #0f172a)',
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          padding: 28,
          borderRadius: 16,
          background: 'var(--sos-surface, #fff)',
          border: '1px solid var(--sos-border, #e2e8f0)',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: '#b45309', marginBottom: 10 }}>SALES DEMO</div>
        <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>{state === 'working' ? 'One moment' : 'Link not usable'}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0, color: 'var(--sos-text-muted, #475569)' }}>{message}</p>
        {state === 'error' ? (
          <p style={{ fontSize: 13, marginTop: 16, color: 'var(--sos-text-muted, #475569)' }}>
            Ask the person who sent you this link for a new one.
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function DemoEnterPage() {
  return (
    <Suspense fallback={null}>
      <DemoEnter />
    </Suspense>
  );
}
