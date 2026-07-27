'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Folder, Search, Loader2, FileText } from 'lucide-react';
import { fetchDatabankClients, type ApiDatabankClientRow } from '@/lib/processing';

/**
 * Cross-client Databank landing. Lists the clients the signed-in user may see
 * — manager: every client; officer: clients they have an assigned case for
 * (the API scopes it) — each with its file count. Clicking a client opens that
 * client's databank (the same explorer as the case-workspace tab, mounted on
 * its own route so it isn't tied to a single case).
 */
export function DatabankClientsPage() {
  const [rows, setRows] = useState<ApiDatabankClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Debounce the search so typing doesn't hammer the endpoint.
    const t = setTimeout(() => {
      fetchDatabankClients(q)
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clients');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const muted = 'var(--sos-text-muted, #64748b)';
  const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';

  const content = useMemo(() => {
    if (loading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, padding: '24px 0' }}>
          <Loader2 size={16} className="animate-spin" /> Loading clients…
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: muted }}>
          {q ? 'No clients match your search.' : 'No client databanks yet.'}
        </div>
      );
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {rows.map((c) => {
          const name = `${c.firstName} ${c.lastName}`.trim();
          return (
            <Link
              key={c.id}
              href={`/processing/databank/${c.id}?name=${encodeURIComponent(name)}` as Route}
              style={{
                border,
                borderRadius: 12,
                padding: 14,
                background: 'var(--sos-surface, rgba(255,255,255,0.6))',
                textDecoration: 'none',
                color: 'var(--sos-text-primary, #0f172a)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span style={{ color: 'var(--sos-accent, #b8860b)', flexShrink: 0 }}>
                <Folder size={26} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name || 'Unnamed client'}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: muted, marginTop: 2 }}>{c.referenceCode}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: muted, marginTop: 4 }}>
                  <FileText size={12} /> {c.fileCount} {c.fileCount === 1 ? 'file' : 'files'}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    );
  }, [loading, rows, q, muted, border]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ position: 'relative', maxWidth: 360 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: muted }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or reference…"
          style={{
            width: '100%',
            border,
            borderRadius: 10,
            padding: '9px 12px 9px 34px',
            fontSize: 13.5,
            background: 'var(--sos-surface-solid, #fff)',
            color: 'var(--sos-text-primary, #0f172a)',
            outline: 'none',
          }}
        />
      </div>
      {error ? (
        <div style={{ fontSize: 13, color: 'var(--sos-danger, #dc2626)' }}>{error}</div>
      ) : null}
      {content}
    </div>
  );
}
