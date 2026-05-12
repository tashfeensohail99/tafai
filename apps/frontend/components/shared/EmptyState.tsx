import { FolderOpen, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  title = 'No results found',
  description,
  icon: Icon = FolderOpen,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--sos-surface-1)' }}
        >
          <Icon className="h-7 w-7" style={{ color: 'var(--sos-text-faint)' }} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-semibold" style={{ color: 'var(--sos-text-secondary)' }}>
            {title}
          </p>
          {description && (
            <p style={{ color: 'var(--sos-text-muted)', fontSize: 'var(--text-sm)' }}>
              {description}
            </p>
          )}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--sos-brand-primary)',
              color: 'var(--sos-text-inverse)',
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
