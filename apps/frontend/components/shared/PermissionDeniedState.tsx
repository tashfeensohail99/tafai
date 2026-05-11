import { ShieldOff } from 'lucide-react';

interface PermissionDeniedStateProps {
  message?: string;
}

export function PermissionDeniedState({
  message = 'You do not have permission to view this page.',
}: PermissionDeniedStateProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--color-status-danger-bg)' }}
        >
          <ShieldOff className="h-7 w-7" style={{ color: 'var(--color-status-danger)' }} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Access Denied
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
