/**
 * The rebuilt-explorer rollout switch (Databank Phase 2, PR-2).
 *
 * Build-time mode `NEXT_PUBLIC_DATABANK_EXPLORER_V2` (baked in by `next build` —
 * Railway needs the Dockerfile ARG) × a per-browser choice:
 *   off   → the legacy explorer everywhere (default; `?explorerV2=` is ignored)
 *   pilot → the rebuilt explorer only for browsers that opted in once with
 *           `?explorerV2=1`
 *   on    → the rebuilt explorer for everyone, except browsers that opted out
 *           with `?explorerV2=0`
 * The per-browser choice is remembered in localStorage.
 */

export type ExplorerV2Mode = 'off' | 'pilot' | 'on';

const STORAGE_KEY = 'databank.explorerV2';

export function parseExplorerMode(raw: string | undefined): ExplorerV2Mode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'pilot') return 'pilot';
  if (v === 'on' || v === '1' || v === 'true') return 'on';
  return 'off';
}

/** Pure decision: given the build mode, the remembered choice and the URL's
 *  `?explorerV2=` value, is V2 on — and what should be remembered? */
export function resolveExplorerV2(
  mode: ExplorerV2Mode,
  stored: string | null,
  query: string | null,
): { enabled: boolean; persist: '1' | '0' | null } {
  if (mode === 'off') return { enabled: false, persist: null };
  const q = query === '1' || query === '0' ? query : null;
  const effective = q ?? stored;
  const enabled = mode === 'pilot' ? effective === '1' : effective !== '0';
  return { enabled, persist: q };
}

/** The build mode. The LITERAL `process.env.NEXT_PUBLIC_…` reference is what
 *  Next inlines at build time — don't make it dynamic. */
export function explorerV2Mode(): ExplorerV2Mode {
  return parseExplorerMode(process.env.NEXT_PUBLIC_DATABANK_EXPLORER_V2);
}

/** Browser only (false during SSR). Every storage access is guarded: private
 *  windows and locked-down browsers throw on localStorage. */
export function isDatabankExplorerV2Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  const mode = explorerV2Mode();
  if (mode === 'off') return false;
  let stored: string | null = null;
  let query: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    query = new URLSearchParams(window.location.search).get('explorerV2');
  } catch {
    /* no location */
  }
  const { enabled, persist } = resolveExplorerV2(mode, stored, query);
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, persist);
    } catch {
      /* storage blocked — the choice just isn't remembered */
    }
  }
  return enabled;
}
