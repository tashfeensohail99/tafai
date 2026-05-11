'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

interface ThemeToggleProps {
  /** Visual size. Defaults to "icon" (square 38px, matches sos-topbar__icon-btn). */
  size?: 'icon' | 'sm';
  /** Optional aria-label override. */
  ariaLabel?: string;
  /** Optional className escape hatch. */
  className?: string;
}

/**
 * ThemeToggle — central single-button switch between light and dark.
 *
 * Render anywhere downstream of `<ThemeProvider>`. The icon shows the theme
 * the click WILL switch to (sun while in dark, moon while in light), matching
 * the convention used by GitHub, Linear, and Notion.
 */
export function ThemeToggle({ size = 'icon', ariaLabel, className }: ThemeToggleProps) {
  const { theme, toggleTheme, isHydrating } = useTheme();
  const goingTo = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;

  const baseStyle = { opacity: isHydrating ? 0 : 1, transition: 'opacity 200ms ease' };

  if (size === 'sm') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={ariaLabel ?? `Switch to ${goingTo} mode`}
        title={`Switch to ${goingTo} mode`}
        className={`sos-btn sos-btn--secondary sos-btn--sm ${className ?? ''}`}
        style={baseStyle}
      >
        <Icon size={13} />
        <span style={{ textTransform: 'capitalize' }}>{goingTo}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={ariaLabel ?? `Switch to ${goingTo} mode`}
      title={`Switch to ${goingTo} mode`}
      className={`sos-topbar__icon-btn ${className ?? ''}`}
      style={baseStyle}
    >
      <Icon size={15} />
    </button>
  );
}
