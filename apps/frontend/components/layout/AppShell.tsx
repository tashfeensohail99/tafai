'use client';

import { useState, type ReactNode } from 'react';
import type { NavGroup } from './Sidebar';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppShellProps {
  children: ReactNode;
  navGroups: NavGroup[];
  logo?: ReactNode;
  pageTitle?: string;
  userName?: string;
  userRole?: string;
  headerEyebrow?: string;
  onLogout?: () => void;
  navIntro?: ReactNode;
}

export function AppShell({
  children,
  navGroups,
  logo,
  pageTitle,
  userName,
  userRole,
  headerEyebrow,
  onLogout,
  navIntro,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div
      className="flex min-h-screen overflow-hidden lg:h-screen"
      style={{ backgroundColor: 'var(--color-surface-muted)' }}
    >
      <Sidebar
        groups={navGroups}
        logo={logo}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        navIntro={navIntro}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          title={pageTitle}
          userName={userName}
          userRole={userRole}
          eyebrow={headerEyebrow}
          onMenuClick={() => setMobileNavOpen(true)}
          onLogout={onLogout}
        />

        <main className="relative z-10 flex-1 overflow-y-auto p-4 pb-10 sm:p-6 lg:p-8 lg:pr-10">
          {children}
        </main>
      </div>
    </div>
  );
}
