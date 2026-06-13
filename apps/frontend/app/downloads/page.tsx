'use client';

import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

interface AppInfo {
  version: string;
  sizeBytes: number;
  uploadedAt: string;
  v7aSizeBytes?: number | null;
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The Tashfeen "T" brand mark (mirrors the app's logo + launcher icon). */
function TMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 75 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tMarkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#C9CDD6" />
        </linearGradient>
      </defs>
      <path
        d="M0,0 L75,0 L75,32 L54.75,32 L50.25,38 L50.25,100 L24.75,100 L20.25,38 L0,32 Z"
        fill="url(#tMarkGrad)"
      />
    </svg>
  );
}

const STEPS = [
  'Tap “Download for Android” above.',
  'If the browser warns about the file type, choose “Download anyway”.',
  'Open the downloaded file; if asked, allow installing from this source.',
  'Open Tashfeen CRM and sign in with your staff account.',
];

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
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0D1B3A] px-4 py-12">
      {/* ambient brand glows */}
      <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-indigo-600/20 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        {/* logo + heading */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[24px] bg-[#16294f] shadow-2xl ring-1 ring-white/10">
            <TMark className="h-10 w-[30px]" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Tashfeen CRM</h1>
          <p className="mt-2 text-sm text-slate-400">Immigration Solutions · Android app</p>
        </div>

        {/* card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-xl">
          {info ? (
            <div className="mb-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] font-medium text-slate-300">
              <span className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white">
                v{info.version}
              </span>
              <span>{fmtSize(info.sizeBytes)}</span>
              <span className="text-slate-500">·</span>
              <span>updated {new Date(info.uploadedAt).toLocaleDateString('en-GB')}</span>
            </div>
          ) : !unavailable ? (
            <div className="mx-auto mb-5 h-7 w-48 animate-pulse rounded-full bg-white/10" />
          ) : null}

          {unavailable ? (
            <p className="rounded-2xl bg-amber-500/15 px-4 py-3 text-center text-sm font-medium text-amber-300">
              No build has been published yet — check back soon.
            </p>
          ) : (
            <>
              <a
                href={`${apiBase}/public/app/android`}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-white px-6 py-4 text-base font-bold text-[#0D1B3A] shadow-lg transition hover:bg-slate-100 active:scale-[0.99]"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
                Download for Android
              </a>
              <a
                href={`${apiBase}/public/app/android/v7a`}
                className="mt-3 block text-center text-xs font-medium text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline"
              >
                Older or 32-bit phone? Get the compatible version
              </a>

              <div className="my-6 h-px bg-white/10" />

              <h2 className="mb-3.5 text-sm font-semibold text-white">How to install</h2>
              <ol className="space-y-3">
                {STEPS.map((step, i) => (
                  <li key={i} className="flex gap-3 text-[13px] leading-6 text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-xs leading-5 text-slate-500">
          Android only · a staff login is required after installing.
          <br />
          Tashfeen Immigration Solutions · tashfeengroup.com
        </p>
      </div>
    </main>
  );
}
