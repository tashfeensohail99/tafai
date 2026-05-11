'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permissionKey?: string;
  subtitle?: string;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

interface SidebarProps {
  groups: NavGroup[];
  logo?: ReactNode;
  mobileOpen: boolean;
  onMobileClose: () => void;
  navIntro?: ReactNode;
}

export function Sidebar({ groups, logo, mobileOpen, onMobileClose, navIntro }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const showLabels = !collapsed || mobileOpen;
  const sidebarWidth = mobileOpen
    ? 'min(85vw, 20rem)'
    : collapsed
      ? 'var(--sidebar-collapsed-width)'
      : 'var(--sidebar-width)';

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          onClick={onMobileClose}
          className="fixed inset-0 z-30 bg-[#041C4D]/50 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation overlay"
        />
      ) : null}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r transition-transform duration-200',
          'lg:static lg:z-auto lg:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-lg' : '-translate-x-full',
        )}
        style={{
          width: sidebarWidth,
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <div
          className="flex h-[var(--topbar-height)] items-center justify-between px-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          {showLabels ? logo : null}
          <button
            type="button"
            onClick={onMobileClose}
            className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-subtle)] lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {showLabels && navIntro ? <div className="px-3 pt-3">{navIntro}</div> : null}

        <nav className="flex-1 overflow-y-auto py-4">
          {groups.map((group, gi) => (
            <div key={gi} className="mb-2">
              {showLabels && group.label ? (
                <p
                  className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--color-text-disabled)' }}
                >
                  {group.label}
                </p>
              ) : null}
              {group.items.map((item) => {
                const active =
                  item.href === '/admin'
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    onClick={() => {
                      if (mobileOpen) {
                        onMobileClose();
                      }
                    }}
                    className={clsx(
                      'mx-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-[var(--color-primary-600)] text-white'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]',
                    )}
                    title={!showLabels ? item.label : undefined}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {showLabels ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((current) => !current)}
          className="absolute -right-3 top-[calc(var(--topbar-height)+12px)] hidden h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-colors hover:bg-[var(--color-surface-subtle)] lg:flex"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      </aside>
    </>
  );
}
