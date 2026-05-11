'use client';

import { ChevronDown, LogOut, PanelLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { ThemeToggle } from './ThemeToggle';

interface TopbarProps {
  title?: string;
  userName?: string;
  userRole?: string;
  onMenuClick?: () => void;
  eyebrow?: string;
  onLogout?: () => void;
}

export function Topbar({ title, userName, userRole, onMenuClick, eyebrow, onLogout }: TopbarProps) {
  return (
    <header
      className={clsx(
        'flex items-center justify-between border-b px-4 sm:px-6',
        'h-[var(--topbar-height)]',
      )}
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenuClick}
          className={clsx(
            'inline-flex rounded-md p-2 transition-colors lg:hidden',
            'hover:bg-[var(--color-surface-subtle)]',
          )}
          aria-label="Open navigation"
          title="Open navigation"
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0">
          {eyebrow ? (
            <p
              className="text-[0.62rem] font-semibold uppercase tracking-[0.3em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h1
              className="truncate text-base font-semibold sm:text-lg"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {title}
            </h1>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />

        {userName ? (
          <button className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--color-surface-subtle)]">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
              style={{
                backgroundColor: 'var(--color-primary-600)',
                color: 'var(--color-text-inverse)',
              }}
            >
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="hidden flex-col items-start md:flex">
              <span
                className="text-xs font-medium leading-none"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {userName}
              </span>
              {userRole ? (
                <span
                  className="text-xs leading-none"
                  style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}
                >
                  {userRole}
                </span>
              ) : null}
            </div>
            <ChevronDown className="hidden h-3 w-3 md:block" style={{ color: 'var(--color-text-muted)' }} />
          </button>
        ) : null}

        {onLogout ? (
          <button
            type="button"
            onClick={onLogout}
            className={clsx(
              'inline-flex items-center gap-2 text-sm font-semibold transition-colors',
              'rounded-md border px-3 py-2 hover:bg-[var(--color-surface-subtle)]',
            )}
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        ) : null}
      </div>
    </header>
  );
}
