'use client';

import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';

interface WorkspacePlaceholderProps {
  title: string;
  description: string;
  note: string;
}

export function WorkspacePlaceholder({ title, description, note }: WorkspacePlaceholderProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <section
        className="rounded-[28px] border border-dashed p-8"
        style={{
          borderColor: 'var(--color-border-strong)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              color: 'var(--color-primary-600)',
            }}
          >
            <Hammer className="h-6 w-6" />
          </span>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              This workspace slice is next in line.
            </h3>
            <p className="text-sm sm:text-base" style={{ color: 'var(--color-text-muted)' }}>
              {note}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}