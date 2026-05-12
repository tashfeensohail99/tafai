import { type StatusType, getStatusConfig } from '@/lib/status-config';
import { clsx } from 'clsx';

interface StatusBadgeProps {
  type: StatusType;
  status: string;
  className?: string;
}

const variantClasses: Record<string, string> = {
  success: 'bg-[var(--color-status-success-bg)] text-[var(--sos-status-success)] border-[var(--sos-status-success)]',
  warning: 'bg-[var(--color-status-warning-bg)] text-[var(--sos-status-warning)] border-[var(--sos-status-warning)]',
  danger: 'bg-[var(--color-status-danger-bg)] text-[var(--sos-status-danger)] border-[var(--sos-status-danger)]',
  info: 'bg-[var(--color-status-info-bg)] text-[var(--sos-status-info)] border-[var(--sos-status-info)]',
  neutral: 'bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)] border-[var(--color-status-neutral)]',
  purple: 'bg-[var(--color-status-purple-bg)] text-[var(--color-status-purple)] border-[var(--color-status-purple-border)]',
};

export function StatusBadge({ type, status, className }: StatusBadgeProps) {
  const config = getStatusConfig(type, status);

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variantClasses[config.variant],
        className,
      )}
    >
      {config.label}
    </span>
  );
}
