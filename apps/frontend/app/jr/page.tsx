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
// matter identifiers it is seeded with stay internal. Which module opens is
// driven by the signed-in user's role:
//   • jr_head        → JR Head console (all cases, assign to associates), locked
//   • jr_associate   → Associate workspace (own cases + own report), locked
//   • admin / other  → Head console with the role toggle available to inspect both
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

  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed') {
      const ok = session.user.roles.some((r) => STAFF_ROLES.has(r));
      if (!ok) router.replace(destinationForUser(session.user));
    }
  }, [session, router]);

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted, #888)' }}>
        Loading…
      </div>
    );
  }
  if (session.status !== 'authed') return null;

  const roles = session.user.roles;
  if (!roles.some((r) => STAFF_ROLES.has(r))) return null;

  // Open the desk in the module that matches the login.
  const isAdmin = roles.includes('admin') || roles.includes('super_admin');
  const isHead = roles.includes('jr_head');
  const isAssoc = roles.includes('jr_associate');
  let mode: 'head' | 'assoc' = 'head';
  let lock = false;
  if (isAssoc && !isAdmin && !isHead) {
    mode = 'assoc';
    lock = true;
  } else if (isHead && !isAdmin) {
    mode = 'head';
    lock = true;
  }
  // Admins and non-JR staff open the Head console with the toggle available.

  const boot = JSON.stringify({ role: mode, lock });
  const html = proto.html.replace(
    '<body>\n',
    `<body>\n<script>window.__JR_BOOT__=${boot};</script>\n`,
  );

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
        srcDoc={html}
        sandbox="allow-scripts"
        style={{ flex: 1, width: '100%', border: 0 }}
      />
    </div>
  );
}
