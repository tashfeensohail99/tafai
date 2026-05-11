/**
 * Sales OS premium dark-glass design tokens.
 *
 * Mirrors `styles/sales-os.css` and exposes the same values to TS components
 * so layouts can reference them by name rather than hardcoding.
 *
 * RULE: Never hardcode colors, radii, or shadows in pages — always reach
 * for `salesOsTokens.*` (or the `.sos-*` utility classes that consume the
 * same CSS variables).
 */

export const salesOsTokens = {
  colors: {
    background: {
      app: 'var(--sos-bg-app)',
      deep: 'var(--sos-bg-deep)',
      elevated: 'var(--sos-bg-elevated)',
      glassTop: 'var(--sos-bg-glass-top)',
      glassBottom: 'var(--sos-bg-glass-bottom)',
      glassStrongTop: 'var(--sos-bg-glass-strong-top)',
      glassStrongBottom: 'var(--sos-bg-glass-strong-bottom)',
      input: 'var(--sos-bg-input)',
      overlay: 'var(--sos-bg-overlay)',
    },
    text: {
      primary: 'var(--sos-text-primary)',
      secondary: 'var(--sos-text-secondary)',
      muted: 'var(--sos-text-muted)',
      faint: 'var(--sos-text-faint)',
      inverse: 'var(--sos-text-inverse)',
      onAccent: 'var(--sos-text-on-accent)',
    },
    brand: {
      primary: 'var(--sos-brand-primary)',
      primaryStrong: 'var(--sos-brand-primary-strong)',
      primarySoft: 'var(--sos-brand-primary-soft)',
      accent: 'var(--sos-brand-accent)',
      accentSoft: 'var(--sos-brand-accent-soft)',
      deep: 'var(--sos-brand-deep)',
      gradient: 'var(--sos-brand-gradient)',
      gradientSoft: 'var(--sos-brand-gradient-soft)',
      warmGradient: 'var(--sos-brand-warm-gradient)',
    },
    status: {
      success: 'var(--sos-status-success)',
      successSoft: 'var(--sos-status-success-soft)',
      warning: 'var(--sos-status-warning)',
      warningSoft: 'var(--sos-status-warning-soft)',
      danger: 'var(--sos-status-danger)',
      dangerSoft: 'var(--sos-status-danger-soft)',
      info: 'var(--sos-status-info)',
      infoSoft: 'var(--sos-status-info-soft)',
      violet: 'var(--sos-status-violet)',
      violetSoft: 'var(--sos-status-violet-soft)',
      cyan: 'var(--sos-status-cyan)',
      cyanSoft: 'var(--sos-status-cyan-soft)',
      pink: 'var(--sos-status-pink)',
      pinkSoft: 'var(--sos-status-pink-soft)',
      neutral: 'var(--sos-status-neutral)',
      neutralSoft: 'var(--sos-status-neutral-soft)',
    },
    border: {
      subtle: 'var(--sos-border-subtle)',
      base: 'var(--sos-border)',
      strong: 'var(--sos-border-strong)',
      accent: 'var(--sos-border-accent)',
      divider: 'var(--sos-divider)',
    },
  },
  radius: {
    xs: 'var(--sos-radius-xs)',
    sm: 'var(--sos-radius-sm)',
    button: 'var(--sos-radius-button)',
    input: 'var(--sos-radius-input)',
    pill: 'var(--sos-radius-pill)',
    card: 'var(--sos-radius-card)',
    panel: 'var(--sos-radius-panel)',
    hero: 'var(--sos-radius-hero)',
  },
  shadow: {
    xs: 'var(--sos-shadow-xs)',
    sm: 'var(--sos-shadow-sm)',
    md: 'var(--sos-shadow-md)',
    lg: 'var(--sos-shadow-lg)',
    glass: 'var(--sos-shadow-glass)',
    glow: 'var(--sos-shadow-glow)',
    warm: 'var(--sos-shadow-warm)',
  },
  spacing: {
    1: 'var(--sos-space-1)',
    2: 'var(--sos-space-2)',
    3: 'var(--sos-space-3)',
    4: 'var(--sos-space-4)',
    5: 'var(--sos-space-5)',
    6: 'var(--sos-space-6)',
    7: 'var(--sos-space-7)',
    8: 'var(--sos-space-8)',
    10: 'var(--sos-space-10)',
    12: 'var(--sos-space-12)',
    16: 'var(--sos-space-16)',
  },
  font: {
    display: 'var(--sos-font-display)',
    sans: 'var(--sos-font-sans)',
  },
} as const;

export type SalesOsTokens = typeof salesOsTokens;
