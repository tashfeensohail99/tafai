'use client';
// Marketing workspace shell — mirrors ReceptionShell / ProcessingShell.
// A marketing-role user logs in and lands here; the Overview is home.

import {
  Activity,
  BarChart3,
  Bell,
  Filter,
  Layers,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Split,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DrawerMenu, type DrawerMenuItem } from '@/components/sales-v2/ui/DrawerMenu';
import { RoleBadge } from '@/components/sales-v2/ui/RoleBadge';
import { ThemeToggle } from './ThemeToggle';
import { NotificationsBell } from './NotificationsBell';
import { logout as sessionLogout, useSession } from '@/lib/session';

export interface MarketingUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: string;
  roles: string[];
  permissions: string[];
}

interface MarketingSessionContextValue {
  user: MarketingUser;
  logout: () => void;
}

const MarketingSessionContext = createContext<MarketingSessionContextValue | null>(null);

export function useMarketingSession(): MarketingSessionContextValue {
  const ctx = useContext(MarketingSessionContext);
  if (!ctx) {
    throw new Error('useMarketingSession must be used inside <MarketingShell>');
  }
  return ctx;
}

// Admins get oversight; the dedicated marketing role is the primary occupant.
const MARKETING_ROLES = new Set(['marketing', 'super_admin', 'admin']);

const NAV: DrawerMenuItem[] = [
  { label: 'Overview', href: '/marketing', icon: LayoutDashboard, caption: 'Spend, leads & KPIs' },
  { label: 'Meta Ads', href: '/marketing/ads', icon: Megaphone, caption: 'Every ad, status & routing' },
  { label: 'Campaigns', href: '/marketing/campaigns', icon: Layers, caption: 'Campaign → ad set → ad' },
  { label: 'Leads', href: '/marketing/leads', icon: Users, caption: 'Meta-sourced leads' },
  { label: 'Lead Routing', href: '/marketing/routing', icon: Split, caption: 'Islamabad / Lahore / Both' },
  { label: 'Performance', href: '/marketing/performance', icon: TrendingUp, caption: 'CPL, CTR, ROAS by ad' },
  { label: 'Conversions', href: '/marketing/conversions', icon: Filter, caption: 'Ad → lead → client funnel' },
  { label: 'AI Insights', href: '/marketing/ai', icon: Sparkles, caption: 'Recommendations (advisory)' },
  { label: 'Alerts', href: '/marketing/alerts', icon: Bell, caption: 'Rejections, CPL spikes, new ads' },
  { label: 'Reports', href: '/marketing/reports', icon: BarChart3, caption: 'Downloadable reporting' },
  { label: 'Integration Health', href: '/marketing/health', icon: Activity, caption: 'Meta sync & webhooks' },
];

function getPageTitle(pathname: string): { title: string; subtitle: string } {
  const found = NAV.find((n) => n.href === pathname);
  if (found) return { title: found.label, subtitle: found.caption ?? '' };
  return { title: 'Marketing', subtitle: '' };
}

export function MarketingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railed, setRailed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('marketing.sidebar.railed') === '1') setRailed(true);
    } catch {
      /* localStorage unavailable — default expanded */
    }
  }, []);
  const toggleRail = () => {
    setRailed((v) => {
      const next = !v;
      try {
        localStorage.setItem('marketing.sidebar.railed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (session.status === 'unauthed') {
      router.replace('/login');
      return;
    }
    if (session.status === 'authed') {
      const hasAccess = session.user.roles.some((r) => MARKETING_ROLES.has(r));
      if (!hasAccess) router.replace('/login');
    }
  }, [session, router]);

  const sessionValue = useMemo<MarketingSessionContextValue | null>(() => {
    if (session.status !== 'authed') return null;
    const emailHandle = session.user.email.split('@')[0] ?? 'marketing';
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: emailHandle,
        initials: emailHandle.slice(0, 2).toUpperCase(),
        role: session.user.roles[0] ?? 'marketing',
        roles: session.user.roles,
        permissions: session.user.permissions,
      },
      logout: () => {
        sessionLogout();
        router.replace('/login');
      },
    };
  }, [session, router]);

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading marketing…
      </div>
    );
  }
  if (session.status !== 'authed' || !sessionValue) return null;

  const user = sessionValue.user;
  const logout = sessionValue.logout;
  const { title, subtitle } = getPageTitle(pathname);

  return (
    <MarketingSessionContext.Provider value={sessionValue}>
      <div className={`sos-shell ${railed ? 'is-railed' : ''}`}>
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className={`sos-sidebar sos-scroll ${mobileOpen ? 'is-open' : ''}`}>
          <div className="sos-sidebar__brand">
            <div className="sos-sidebar__brand-logo">
              <Megaphone size={18} />
            </div>
            <div className="sos-sidebar__brand-text">
              <div className="sos-sidebar__brand-name">Tashfeen</div>
              <div className="sos-sidebar__brand-tagline">Marketing OS</div>
            </div>
            <button
              type="button"
              className="sos-rail-toggle"
              onClick={toggleRail}
              aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={railed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {railed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="sos-mobile-close"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '6px' }}
            >
              <X size={16} />
            </button>
          </div>

          <div className="sos-sidebar__nav sos-scroll">
            <div className="sos-nav-section">Marketing</div>
            <DrawerMenu items={NAV} onNavigate={() => setMobileOpen(false)} />
          </div>

          <div className="sos-sidebar__user">
            <div className="sos-sidebar__user-avatar">{user.initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: 'var(--sos-sidebar-text-strong)', fontSize: '13px', fontWeight: 600 }}>{user.name}</div>
              <div style={{ color: 'var(--sos-sidebar-text-muted)', fontSize: '11px' }}>{user.role}</div>
            </div>
            <button type="button" onClick={logout} aria-label="Logout" style={{ background: 'transparent', border: 'none', color: 'var(--sos-sidebar-text-muted)', cursor: 'pointer', padding: '8px', borderRadius: '10px' }}>
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        {/* ── Mobile overlay ───────────────────────────────────────────── */}
        {mobileOpen && (
          <div
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
          />
        )}

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="sos-main">
          <header className="sos-topbar">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="sos-topbar__mobile-toggle"
              style={{ background: 'transparent', border: 'none', color: 'var(--sos-topbar-icon)', cursor: 'pointer', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center' }}
            >
              <Menu size={18} />
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sos-topbar__title">{title}</div>
              {subtitle ? <div className="sos-topbar__subtitle">{subtitle}</div> : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ThemeToggle />
              <NotificationsBell iconSize={16} />
              <span className="sos-topbar__optional">
                <RoleBadge role="Marketing" />
              </span>
            </div>
          </header>

          <main className="sos-page-content sos-scroll">{children}</main>
        </div>
      </div>
    </MarketingSessionContext.Provider>
  );
}
