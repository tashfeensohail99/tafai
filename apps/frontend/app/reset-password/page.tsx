'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

export const dynamic = 'force-dynamic';

type State = 'form' | 'submitting' | 'success' | 'error';

function ResetContent() {
  const sp = useSearchParams();
  const token = sp.get('token');

  const [state, setState] = useState<State>('form');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('This link is missing its reset token. Please use the link from your email.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setState('submitting');
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    try {
      const res = await fetch(`${apiBase}/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        throw new Error(msg ?? 'Could not reset your password. The link may be invalid or expired.');
      }
      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password.');
      setState('form');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        {state === 'success' ? (
          <>
            <div className="mb-4 text-5xl">✅</div>
            <h1 className="mb-2 text-2xl font-semibold text-slate-900">Password updated</h1>
            <p className="text-sm leading-6 text-slate-600">
              Your password has been reset. You can now sign in with your new password.
            </p>
            <a
              href="/login"
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Go to sign in
            </a>
          </>
        ) : (
          <>
            <div className="mb-4 text-5xl">🔑</div>
            <h1 className="mb-1 text-2xl font-semibold text-slate-900">Choose a new password</h1>
            <p className="mb-6 text-sm text-slate-600">Enter a new password for your Tashfeen account.</p>

            <form onSubmit={onSubmit} className="space-y-3 text-left">
              <label className="block text-sm font-medium text-slate-700">
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Confirm password
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                />
              </label>

              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

              <button
                type="submit"
                disabled={state === 'submitting'}
                className="w-full rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {state === 'submitting' ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          </>
        )}

        <p className="mt-8 text-xs text-slate-400">Tashfeen Immigration Solutions · tashfeengroup.com</p>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetContent />
    </Suspense>
  );
}
