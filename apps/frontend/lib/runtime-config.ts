'use client';

import { useEffect, useState } from 'react';

/**
 * Public runtime configuration served by the backend at GET /config
 * (no auth, no secrets). Lets one frontend image behave as the production
 * CRM or as the sales demo (banner, media placeholders, brand) depending on
 * the backend it talks to.
 */
export interface RuntimeConfig {
  demoMode: boolean;
  brandName: string;
  brandShortName: string;
  demoLiveDisplayNumber: string | null;
  demoLiveLaneEnabled: boolean;
  demoSyncIntervalMinutes: number | null;
}

const BUILD_BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || 'Tashfeen Immigration Solutions';

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
  brandName: BUILD_BRAND,
  brandShortName: BUILD_BRAND.split(' ').slice(0, 2).join(' '),
  demoLiveDisplayNumber: null,
  demoLiveLaneEnabled: false,
  demoSyncIntervalMinutes: null,
};

let cached: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;
const listeners = new Set<(c: RuntimeConfig) => void>();

export function getRuntimeConfigSync(): RuntimeConfig {
  return cached ?? DEFAULT_RUNTIME_CONFIG;
}

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  inflight = fetch(`${base}/config`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j: Partial<RuntimeConfig>) => {
      cached = { ...DEFAULT_RUNTIME_CONFIG, ...j };
      try {
        sessionStorage.setItem('tafsheen-runtime-config', JSON.stringify(cached));
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l(cached!));
      return cached;
    })
    .catch(() => {
      // Backend unreachable: fall back to the build-time defaults (never
      // block the app on this call).
      cached = null;
      return DEFAULT_RUNTIME_CONFIG;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** React hook: build-time defaults first, then the live /config values. */
export function useRuntimeConfig(): RuntimeConfig {
  const [cfg, setCfg] = useState<RuntimeConfig>(() => {
    if (cached) return cached;
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('tafsheen-runtime-config');
        if (raw) return { ...DEFAULT_RUNTIME_CONFIG, ...(JSON.parse(raw) as Partial<RuntimeConfig>) };
      } catch {
        /* ignore */
      }
    }
    return DEFAULT_RUNTIME_CONFIG;
  });
  useEffect(() => {
    let alive = true;
    listeners.add(setCfg);
    loadRuntimeConfig().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
      listeners.delete(setCfg);
    };
  }, []);
  return cfg;
}

export function useDemoMode(): boolean {
  return useRuntimeConfig().demoMode;
}

/** Brand text for sidebars / login (short form, e.g. "Northstar Immigration"). */
export function useBrand(): { name: string; shortName: string; word: string } {
  const c = useRuntimeConfig();
  return { name: c.brandName, shortName: c.brandShortName, word: c.brandShortName.split(' ')[0] || c.brandName };
}

/** True when a message's media is a demo placeholder (bytes never copied). */
export function isDemoMediaPlaceholder(message: { mediaUrl?: string | null; payload?: unknown }): boolean {
  const url = message.mediaUrl ?? '';
  if (url.startsWith('demo:') || url.startsWith('meta:demo-')) return true;
  const p = message.payload as Record<string, { demoPlaceholder?: boolean } | undefined> | null | undefined;
  if (p && typeof p === 'object') {
    for (const k of ['image', 'video', 'audio', 'document', 'sticker', 'voice']) {
      if (p[k]?.demoPlaceholder) return true;
    }
  }
  return false;
}
