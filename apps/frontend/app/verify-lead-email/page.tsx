'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export const dynamic = 'force-dynamic';

type VerifyState = 'loading' | 'success' | 'error';

interface VerifyResult {
  verified: boolean;
  leadName: string;
}

function VerifyContent() {
  const sp = useSearchParams();
  const token = sp.get('token');

  const [state, setState] = useState<VerifyState>('loading');
  const [leadName, setLeadName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMessage('No verification token provided in the link.');
      setState('error');
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url = `${apiBase}/leads/verify-email?token=${encodeURIComponent(token)}`;

    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? 'Verification failed. The link may be invalid or expired.');
        }
        return res.json() as Promise<VerifyResult>;
      })
      .then((data) => {
        setLeadName(data.leadName);
        setState('success');
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : 'Verification failed.');
        setState('error');
      });
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        {state === 'loading' ? (
          <>
            <div className="mb-4 text-5xl">⏳</div>
            <h1 className="mb-2 text-2xl font-semibold text-slate-900">Verifying your email…</h1>
            <p className="text-sm text-slate-600">One moment please.</p>
          </>
        ) : null}

        {state === 'success' ? (
          <>
            <div className="mb-4 text-5xl">✅</div>
            <h1 className="mb-2 text-2xl font-semibold text-slate-900">Email Verified!</h1>
            <p className="text-sm leading-6 text-slate-600">
              {leadName ? (
                <>
                  Hi <strong className="text-slate-900">{leadName}</strong>, your
                </>
              ) : (
                'Your'
              )}{' '}
              email address has been verified successfully.
              <br />
              Our team will be in touch with you shortly.
            </p>
            <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3.5 py-1.5 text-sm font-semibold text-green-700">
              ✓ Verified
            </div>
          </>
        ) : null}

        {state === 'error' ? (
          <>
            <div className="mb-4 text-5xl">❌</div>
            <h1 className="mb-2 text-2xl font-semibold text-slate-900">Verification Failed</h1>
            <p className="text-sm leading-6 text-slate-600">{errorMessage}</p>
            <p className="mt-4 text-sm text-slate-600">
              Please ask a consultant to resend the verification email.
            </p>
          </>
        ) : null}

        <p className="mt-8 text-xs text-slate-400">
          Tashfeen Immigration Solutions · tashfeengroup.com
        </p>
      </div>
    </main>
  );
}

export default function VerifyLeadEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
