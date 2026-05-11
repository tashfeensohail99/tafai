/**
 * Sales OS premium UI kit — the shared premium component surface currently
 * used by Sales and Finance screens. Pages should import everything from here
 * so styles stay token-driven and consistent.
 */

export { salesOsTokens } from './tokens';
export type { SalesOsTokens } from './tokens';

export { GlassCard } from './GlassCard';
export { PageHeader } from './PageHeader';
export { MetricCard } from './MetricCard';
export type { MetricTone } from './MetricCard';
export { StatusBadge } from './StatusBadge';
export type { BadgeTone } from './StatusBadge';
export { RoleBadge } from './RoleBadge';
export { DrawerMenu } from './DrawerMenu';
export type { DrawerMenuItem } from './DrawerMenu';
export { Field, FormInput, FormSelect, FormTextarea } from './FormFields';
export {
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  DangerButton,
  SuccessButton,
  ButtonLink,
} from './Buttons';
export { ActionBar } from './ActionBar';
export { DetailPageShell } from './DetailPageShell';
export { EmptyState } from './EmptyState';
export { TimelineStep, Timeline } from './TimelineStep';
export { UploadBox } from './UploadBox';

// Theme provider + toggle live in `components/layout/` so every workspace
// (admin, sales, partner, client, auth) shares one provider and one toggle.
// Re-exported here for convenience so existing sales pages keep working.
export { ThemeProvider, useTheme, type Theme } from '@/components/layout/ThemeProvider';
export { ThemeToggle } from '@/components/layout/ThemeToggle';
