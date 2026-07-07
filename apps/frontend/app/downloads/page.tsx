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
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
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

/** Android robot mark — the universally-recognised "this is the Android app" cue. */
function AndroidIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48l1.84-3.18a.4.4 0 10-.69-.4l-1.86 3.23a11.43 11.43 0 00-9.78 0L5.25 5.9a.4.4 0 10-.69.4l1.84 3.18A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
    </svg>
  );
}

/** Down-into-tray download glyph. */
function DownloadArrow({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

const STEPS = [
  'Tap the big Download button — one file, works on every Android phone.',
  'If the browser warns about the file, choose “Download anyway”.',
  'Open the downloaded file; if asked, allow installing from this source.',
  'Open Tashfeen CRM and sign in with your staff account.',
];

const TRUST = ['Works on all Android phones', 'Official Tashfeen build', 'Free · staff login required'];

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

  const downloadHref = `${apiBase}/public/app/android`;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0A1631] px-4 py-14">
      {/* ambient brand glows */}
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-blue-500/20 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-28 h-[26rem] w-[26rem] rounded-full bg-indigo-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[130px]" />

      <div className="relative z-10 w-full max-w-md">
        {/* logo + heading */}
        <div className="mb-9 flex flex-col items-center text-center">
          <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-[26px] bg-gradient-to-b from-[#1b3160] to-[#12244a] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/15">
            <TMark className="h-11 w-[33px] drop-shadow" />
          </div>
          <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-white">
            Tashfeen CRM
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">Immigration Solutions · Android app</p>
        </div>

        {/* card */}
        <div className="rounded-[28px] border border-white/10 bg-white/[0.055] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:p-7">
          {/* meta row */}
          {info ? (
            <div className="mb-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[13px] font-medium text-slate-300">
              <span className="rounded-full bg-emerald-400/15 px-3 py-1 font-bold text-emerald-300 ring-1 ring-emerald-400/25">
                v{info.version}
              </span>
              <span>{fmtSize(info.sizeBytes)}</span>
              <span className="text-slate-600">·</span>
              <span>updated {new Date(info.uploadedAt).toLocaleDateString('en-GB')}</span>
            </div>
          ) : !unavailable ? (
            <div className="mx-auto mb-5 h-7 w-52 animate-pulse rounded-full bg-white/10" />
          ) : null}

          {unavailable ? (
            <p className="rounded-2xl bg-amber-500/15 px-4 py-3 text-center text-sm font-medium text-amber-300">
              No build has been published yet — check back soon.
            </p>
          ) : (
            <>
              {/* ── THE one big download button ── */}
              <a
                href={downloadHref}
                download
                className="group relative flex items-center gap-4 overflow-hidden rounded-[22px] bg-gradient-to-br from-[#3DDC84] to-[#12B76A] px-5 py-4 shadow-[0_16px_40px_-10px_rgba(61,220,132,0.55)] transition-all duration-200 hover:shadow-[0_20px_50px_-8px_rgba(61,220,132,0.7)] hover:brightness-[1.04] active:scale-[0.985]"
              >
                {/* sheen */}
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <span className="relative flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-white/25 ring-1 ring-white/40">
                  <AndroidIcon className="h-7 w-7 text-white" />
                </span>
                <span className="relative flex-1 text-left">
                  <span className="block text-[19px] font-extrabold leading-tight text-[#062616]">
                    Download the app
                  </span>
                  <span className="mt-0.5 block text-[12.5px] font-semibold text-[#0b3d24]/80">
                    Android · {info ? fmtSize(info.sizeBytes) : '—'} · works on all phones
                  </span>
                </span>
                <DownloadArrow className="relative h-6 w-6 flex-none text-[#062616] transition-transform duration-200 group-hover:translate-y-0.5" />
              </a>

              {/* trust cues */}
              <ul className="mt-4 space-y-1.5">
                {TRUST.map((t) => (
                  <li key={t} className="flex items-center gap-2 text-[12.5px] font-medium text-slate-300">
                    <CheckIcon className="h-3.5 w-3.5 flex-none text-emerald-400" />
                    {t}
                  </li>
                ))}
              </ul>

              <div className="my-6 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

              <h2 className="mb-4 text-sm font-semibold text-white">How to install</h2>
              <ol className="space-y-3.5">
                {STEPS.map((step, i) => (
                  <li key={i} className="flex gap-3 text-[13px] leading-6 text-slate-300">
                    <span className="mt-0.5 flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-blue-500/40 to-indigo-500/30 text-[11px] font-bold text-white ring-1 ring-white/15">
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
          Android only · one app for every phone · a staff login is required after installing.
          <br />
          Tashfeen Immigration Solutions · tashfeengroup.com
        </p>
      </div>
    </main>
  );
}
