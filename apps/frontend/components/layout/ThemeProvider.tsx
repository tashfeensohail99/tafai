'use client';
// Tafsheen — central theme provider.
// Applies `data-theme="light|dark"` on <html>. Both the legacy `--color-*`
// tokens (tokens.css) and the premium glass `--sos-*` tokens (sales-os.css)
// flip on this attribute, so admin / sales / partner / client / auth all
// theme together with one toggle.
//
// Storage key: `tafsheen-theme`. First-load default: `prefers-color-scheme`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tafsheen-theme';
const ATTRIBUTE = 'data-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** True until the client-side preference (localStorage / prefers-color-scheme)
   *  has been resolved. Use to suppress hydration-mismatch flicker. */
  isHydrating: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  /** Theme used during SSR and first paint, before localStorage is read. */
  defaultTheme?: Theme;
  children: ReactNode;
}

export function ThemeProvider({
  defaultTheme = 'light',
  children,
}: ThemeProviderProps) {
  // Render the default on server + first client paint to avoid hydration
  // mismatch. The actual preference is applied in useEffect below.
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    let resolved: Theme = defaultTheme;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        resolved = stored;
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        resolved = 'dark';
      }
    } catch {
      // Privacy mode or other storage failure — stay on default.
    }
    document.documentElement.setAttribute(ATTRIBUTE, resolved);
    setThemeState(resolved);
    setIsHydrating(false);
  }, [defaultTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute(ATTRIBUTE, next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute(ATTRIBUTE, next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme, isHydrating }),
    [theme, setTheme, toggleTheme, isHydrating],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback — keeps stories / isolated components rendering without
    // a wrapping provider. Real apps go through the root layout.
    return {
      theme: 'light',
      setTheme: () => {},
      toggleTheme: () => {},
      isHydrating: false,
    };
  }
  return ctx;
}
