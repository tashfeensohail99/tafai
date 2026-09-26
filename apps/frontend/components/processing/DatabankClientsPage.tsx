'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Folder, FolderOpen, Search, Loader2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  fetchDatabankByAssociate,
  type ApiDatabankAssociate,
  type ApiDatabankByAssociate,
  type ApiDatabankClientRow,
} from '@/lib/processing';
import { DatabankTab } from './tabs/DatabankTab';

/**
 * Databank landing, organised by ASSOCIATE.
 *
 * A processing manager (view_all) sees one folder per associate — her own
 * first, then everyone else's — and drills into an associate to see that
 * person's client folders. An officer skips the associate level entirely and
 * lands straight on their own clients. The server does the grouping and
 * scoping (GET /processing/databank/clients/by-associate); the client just
 * renders it. Clicking a client opens that client's databank (the same
 * explorer as the case-workspace tab, on its own route).
 */
export function DatabankClientsPage() {
  const [data, setData] = useState<ApiDatabankByAssociate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Debounce the search so typing doesn't hammer the endpoint.
    const t = setTimeout(() => {
      fetchDatabankByAssociate(q)
        .then((r) => {
          if (!cancelled) setData(r);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load databank');
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

  // The associate currently drilled into (managers only). Falls back to null
  // when a search narrows the selected associate out of the results.
  const selected = useMemo(
    () => data?.associates.find((a) => a.officerId === selectedOfficerId) ?? null,
    [data, selectedOfficerId],
  );

  const content = useMemo(() => {
    if (loading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, padding: '24px 0' }}>
          <Loader2 size={16} className="animate-spin" /> Loading databank…
        </div>
      );
    }
    if (!data) return null;
    const groups = data.associates;

    // ---- Drilled into one associate (multi-associate view) -----------------
    if (selected) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button
            type="button"
            onClick={() => setSelectedOfficerId(null)}
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              border,
              borderRadius: 8,
              padding: '6px 10px 6px 6px',
              background: 'var(--sos-surface, rgba(255,255,255,0.6))',
              color: 'var(--sos-text-primary, #0f172a)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <ChevronLeft size={16} /> All associates
          </button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>
              {selected.isSelf ? 'My databank' : `${selected.officerName}’s databank`}
            </span>
            <span style={{ fontSize: 13, color: muted }}>
              {selected.clientCount} {selected.clientCount === 1 ? 'client' : 'clients'}
            </span>
          </div>
          {/* Your OWN folders — a personal databank area, only in your own view.
              Documents not tied to a specific client; only you + a manager see it. */}
          {selected.isSelf ? (
            <div
              style={{
                border,
                borderRadius: 12,
                padding: 14,
                background: 'var(--sos-surface, rgba(255,255,255,0.6))',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FolderOpen size={16} style={{ color: 'var(--sos-accent, #b8860b)' }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>My folders</span>
                </div>
                <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
                  Your own folders — for documents not tied to a specific client. Only you and a manager can see these.
                </div>
              </div>
              <DatabankTab personal rootLabel="My folders" />
            </div>
          ) : null}
          <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--sos-text-primary, #0f172a)', marginTop: 2 }}>
            {selected.isSelf ? 'My clients' : 'Clients'}
          </div>
          {selected.clients.length === 0 ? (
            <EmptyState text="No clients in this databank yet." />
          ) : (
            <ClientGrid clients={selected.clients} muted={muted} border={border} />
          )}
        </div>
      );
    }

    // ---- One group (or none): show its clients directly --------------------
    // A lone officer (their own single group) lands straight on their clients;
    // when there are multiple associates, everyone — manager or officer — gets
    // the drill-in cards (team-wide read; write is still gated per-action).
    if (groups.length <= 1) {
      const clients = groups[0]?.clients ?? [];
      if (clients.length === 0) {
        return <EmptyState text={q ? 'No clients match your search.' : 'No client databanks yet.'} />;
      }
      return <ClientGrid clients={clients} muted={muted} border={border} />;
    }

    // ---- Multiple associates: the associate grid (drill-in) ----------------
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {groups.map((a) => (
          <AssociateCard
            key={a.officerId}
            associate={a}
            muted={muted}
            border={border}
            onOpen={() => setSelectedOfficerId(a.officerId)}
          />
        ))}
      </div>
    );
  }, [loading, data, selected, q, muted, border]);

  const showManagerHint = !loading && (data?.associates.length ?? 0) > 1 && !selected;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ position: 'relative', maxWidth: 360 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: muted }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={showManagerHint ? 'Search associate, client or reference…' : 'Search by name or reference…'}
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

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--sos-text-muted, #64748b)' }}>{text}</div>
  );
}

/** Two-letter initials for an associate's avatar (first + last word). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** One associate on the databank landing — initials avatar + client count. */
function AssociateCard({
  associate,
  muted,
  border,
  onOpen,
}: {
  associate: ApiDatabankAssociate;
  muted: string;
  border: string;
  onOpen: () => void;
}) {
  const self = associate.isSelf;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        border,
        borderRadius: 12,
        padding: 14,
        background: 'var(--sos-surface, rgba(255,255,255,0.6))',
        color: 'var(--sos-text-primary, #0f172a)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          background: self ? 'rgba(184,134,11,0.14)' : 'rgba(148,163,184,0.18)',
          color: self ? 'var(--sos-accent, #b8860b)' : 'var(--sos-text-muted, #64748b)',
        }}
      >
        {initials(associate.officerName)}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {associate.officerName}
          </span>
          {self ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--sos-accent, #b8860b)',
                background: 'rgba(184,134,11,0.12)',
                borderRadius: 6,
                padding: '1px 6px',
                flexShrink: 0,
              }}
            >
              You
            </span>
          ) : null}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: muted, marginTop: 4 }}>
          <Folder size={12} /> {associate.clientCount} {associate.clientCount === 1 ? 'client' : 'clients'}
        </span>
      </span>
      <ChevronRight size={16} style={{ color: muted, flexShrink: 0 }} />
    </button>
  );
}

/** The grid of client folders (shared by the officer view and the manager's
 *  drilled-in associate view). */
function ClientGrid({
  clients,
  muted,
  border,
}: {
  clients: ApiDatabankClientRow[];
  muted: string;
  border: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {clients.map((c) => {
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
              <FolderOpen size={26} />
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
}
