'use client';
// Client Portal Shell — Phase 1C.
// Lighter, client-facing shell. Same glass tokens as Sales/Finance/Processing.
// Sidebar shows case summary and simple navigation.

import {
  CheckCircle2,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Menu,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import {
  MOCK_CLIENT,
  MOCK_CLIENT_CASE,
  CLIENT_STAGE_LABEL,
  CLIENT_STAGE_TONE,
  getDocActionRequired,
} from '@/components/portal/clientMockData';
import { StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';

// ---------- Nav items -------------------------------------------------------

interface PortalNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  caption: string;
  badge?: number;
}

function usePortalNav(): PortalNavItem[] {
  const actionRequired = getDocActionRequired().length;
  return [
    { label: 'My Case', href: '/portal/case', icon: LayoutDashboard, caption: 'Overview and status' },
    { label: 'Documents', href: '/portal/case/documents', icon: FileText, caption: 'Upload and check status', badge: actionRequired > 0 ? actionRequired : undefined },
    { label: 'Messages', href: '/portal/case/messages', icon: MessageSquare, caption: 'Your officer and updates' },
    { label: 'Timeline', href: '/portal/case/timeline', icon: Clock, caption: 'Case history' },
  ];
}

// ---------- Sidebar ---------------------------------------------------------

function PortalSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = usePortalNav();
  const stageTone = CLIENT_STAGE_TONE[MOCK_CLIENT_CASE.stage] as BadgeTone;
  const stageLabel = CLIENT_STAGE_LABEL[MOCK_CLIENT_CASE.stage];

  function handleLogout() {
    router.push('/login');
  }

  return (
    <>
      {/* Mobile overlay */}
      {open ? (
        <div
          className="sos-drawer-backdrop"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <nav className={`sos-sidebar${open ? ' is-open' : ''}`} aria-label="Client portal navigation" style={{ width: '260px' }}>
        {/* Brand */}
        <div className="sos-sidebar__brand">
          <div className="sos-sidebar__brand-logo">
            <CheckCircle2 size={22} />
          </div>
          <div className="sos-sidebar__brand-text">
            <div className="sos-sidebar__brand-name">Client Portal</div>
            <div className="sos-sidebar__brand-tagline">Tafsheen Immigration</div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '4px', display: 'none' }}
            className="portal-close-btn"
          >
            <X size={18} />
          </button>
        </div>

        {/* Case summary panel */}
        <div className="sos-sidebar__panel" style={{ margin: '12px 12px 4px' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--sos-sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '8px' }}>
            Your application
          </div>
          <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--sos-sidebar-text-strong)', marginBottom: '4px' }}>
            {MOCK_CLIENT_CASE.service}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--sos-sidebar-text-muted)', marginBottom: '10px' }}>
            {MOCK_CLIENT_CASE.targetCountry}
          </div>
          <StatusBadge tone={stageTone} size="sm">{stageLabel}</StatusBadge>
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '11px', color: 'var(--sos-sidebar-text-muted)', marginBottom: '5px' }}>
              Documents: {MOCK_CLIENT_CASE.docsAccepted} / {MOCK_CLIENT_CASE.docsTotal} accepted
            </div>
            <div style={{ height: '5px', background: 'var(--sos-sidebar-progress-bg)', borderRadius: '999px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round((MOCK_CLIENT_CASE.docsAccepted / MOCK_CLIENT_CASE.docsTotal) * 100)}%`,
                  height: '100%',
                  background: 'var(--sos-brand-gradient)',
                  borderRadius: '999px',
                  transition: 'width 400ms',
                }}
              />
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="sos-sidebar__nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/portal/case' && pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className="sos-nav-link"
                onClick={onClose}
              >
                <span className="sos-nav-link__icon"><Icon size={17} /></span>
                <span className="sos-nav-link__body">
                  <span className="sos-nav-link__label">{item.label}</span>
                  <span className="sos-nav-link__caption">{item.caption}</span>
                </span>
                {item.badge ? (
                  <span className="sos-nav-link__badge">{item.badge}</span>
                ) : null}
              </a>
            );
          })}
        </div>

        {/* User footer */}
        <div className="sos-sidebar__user">
          <div className="sos-sidebar__user-avatar">{MOCK_CLIENT.initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-sidebar-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {MOCK_CLIENT.name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--sos-sidebar-text-muted)' }}>Client</div>
          </div>
          <button
            type="button"
            aria-label="Log out"
            onClick={handleLogout}
            style={{ background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '4px', borderRadius: '8px', transition: 'color 150ms' }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </nav>
    </>
  );
}

// ---------- Topbar ----------------------------------------------------------

function PortalTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();

  function getTitle(path: string): { title: string; subtitle: string } {
    if (path === '/portal/case') return { title: 'My Case', subtitle: 'Your application overview' };
    if (path.startsWith('/portal/case/documents')) return { title: 'Documents', subtitle: 'Upload and track your documents' };
    if (path.startsWith('/portal/case/messages')) return { title: 'Messages', subtitle: 'Communication with your officer' };
    if (path.startsWith('/portal/case/timeline')) return { title: 'Case Timeline', subtitle: 'History of your application' };
    return { title: 'Client Portal', subtitle: '' };
  }

  const { title, subtitle } = getTitle(pathname);

  return (
    <header className="sos-topbar">
      <button
        type="button"
        aria-label="Open menu"
        onClick={onMenuClick}
        className="sos-topbar__icon-btn"
        style={{ flexShrink: 0 }}
      >
        <Menu size={18} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sos-topbar__title">{title}</div>
        {subtitle ? (
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '1px' }}>{subtitle}</div>
        ) : null}
      </div>

      <ThemeToggle />
    </header>
  );
}

// ---------- Shell -----------------------------------------------------------

interface ClientPortalShellProps {
  children: ReactNode;
}

export function ClientPortalShell({ children }: ClientPortalShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="sos-shell">
      <PortalSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="sos-content">
        <PortalTopbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="sos-page">{children}</main>
      </div>
    </div>
  );
}
