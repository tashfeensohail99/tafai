'use client';

import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

interface AppInfo {
  version: string;
  sizeBytes: number;
  uploadedAt: string;
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DownloadsPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/public/app/info`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('not published');
        return res.json() as Promise<AppInfo>;
      })
      .then(setInfo)
      .catch(() => setUnavailable(true));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mb-4 text-5xl">📱</div>
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">Tashfeen CRM for Android</h1>
        <p className="text-sm text-slate-600">Internal app for the Tashfeen team.</p>

        {info ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-600">
            <span className="font-semibold text-slate-900">v{info.version}</span>
            <span>·</span>
            <span>{fmtSize(info.sizeBytes)}</span>
            <span>·</span>
            <span>updated {new Date(info.uploadedAt).toLocaleDateString('en-GB')}</span>
          </div>
        ) : null}

        {unavailable ? (
          <p className="mt-4 text-sm font-medium text-amber-700">
            No build has been published yet — check back soon.
          </p>
        ) : (
          <>
            <a
              href={`${apiBase}/public/app/android`}
              className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700"
            >
              ⬇&nbsp; Download for Android
            </a>
            <a
              href={`${apiBase}/public/app/android/v7a`}
              className="mt-3 inline-block text-xs font-medium text-slate-500 underline-offset-2 transition hover:text-slate-700 hover:underline"
            >
              Older or 32-bit phone? Get the compatible version
            </a>
          </>
        )}

        <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">How to install</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
            <li>Tap the download button above.</li>
            <li>If the browser warns about the file type, choose “Download anyway”.</li>
            <li>Open the downloaded file. If asked, allow your browser to install unknown apps.</li>
            <li>Open the app and sign in with your CRM account.</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Android only (iPhone version coming later). The app is for Tashfeen staff — a CRM
            login is required to use it after installing.
          </p>
        </div>

        <p className="mt-8 text-xs text-slate-400">
          Tashfeen Immigration Solutions · tashfeengroup.com
        </p>
      </div>
    </main>
  );
}
