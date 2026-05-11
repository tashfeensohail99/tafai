'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';

export interface DrawerMenuItem {
  label: string;
  href: string;
  caption?: string;
  icon: LucideIcon;
  badge?: number | string;
}

interface DrawerMenuProps {
  items: DrawerMenuItem[];
  onNavigate?: () => void;
}

/**
 * DrawerMenu — navigation list for the sales sidebar / mobile drawer.
 * Each item shows an icon, label, optional caption, and active gradient state.
 */
export function DrawerMenu({ items, onNavigate }: DrawerMenuProps) {
  const pathname = usePathname();

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== '/sales' && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={isActive ? 'page' : undefined}
            className="sos-nav-link"
            onClick={onNavigate}
          >
            <span className="sos-nav-link__icon">
              <Icon size={16} />
            </span>
            <span className="sos-nav-link__body">
              <span className="sos-nav-link__label">{item.label}</span>
              {item.caption ? <span className="sos-nav-link__caption">{item.caption}</span> : null}
            </span>
            {item.badge ? <span className="sos-nav-link__badge">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
