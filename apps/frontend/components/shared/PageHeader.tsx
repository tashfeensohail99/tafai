import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm sm:text-base" style={{ color: 'var(--color-text-muted)' }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">{actions}</div> : null}
    </div>
  );
}