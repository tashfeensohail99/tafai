'use client';

// ---------------------------------------------------------------------------
// /jr — Judicial Review desk PROTOTYPE.
//
// A clickable, mock-data prototype of the planned Judicial Review module
// (see docs/judicial-review-module-architecture.md §10 and §11.7). It makes
// NO backend calls: the whole thing is a self-contained HTML/CSS/JS document
// embedded from ./prototype.json and rendered inside a sandboxed iframe, so it
// cannot touch the live app, the session, or any real data.
//
// It is gated behind the same login as the rest of the workspace so the real
// matter identifiers it is seeded with stay internal. Any signed-in staff
// member (JR team + admins) may open it; clients are sent back to their portal.
//
// When the real module ships (PRs 0–10 in the architecture doc) this route is
// replaced by the (jr) route group + JrShell; until then this is the shareable
// preview at tashfeengroup.com/jr.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, destinationForUser } from '@/lib/session';
import proto from './prototype.json';

// Staff roles allowed to view the prototype. Clients are excluded.
const STAFF_ROLES = new Set<string>([
  'super_admin',
  'admin',
  'jr',
  'jr_head',
  'jr_associate',
  'sales',
  'finance',
  'processing',
  'processing_manager',
  'documentation',
  'reception',
  'marketing',
]);

export default function JrPrototypePage() {
  const session = useSession();
  const router = useRouter();

  const allowed =
    session.status === 'authed' && session.user.roles.some((r) => STAFF_ROLES.has(r));

  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed' && !allowed) {
      // Signed in, but not staff (e.g. a client) — send them home.
      router.replace(destinationForUser(session.user));
    }
  }, [session, allowed, router]);

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted, #888)' }}>
        Loading…
      </div>
    );
  }
  if (!allowed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#0f121b',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '7px 16px',
          fontSize: 12.5,
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          color: '#f0e6d0',
          background: '#1a2340',
          borderBottom: '1px solid rgba(0,0,0,.3)',
        }}
      >
        <strong style={{ letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 11 }}>
          Prototype
        </strong>
        <span style={{ opacity: 0.85 }}>
          Judicial Review desk — mock data, not connected to live cases.
        </span>
        <a
          href={destinationForUser(session.user)}
          style={{ marginLeft: 'auto', color: '#e8ddc6', textDecoration: 'underline' }}
        >
          Back to your workspace
        </a>
      </div>
      <iframe
        title="Judicial Review desk prototype"
        srcDoc={proto.html}
        sandbox="allow-scripts"
        style={{ flex: 1, width: '100%', border: 0 }}
      />
    </div>
  );
}
