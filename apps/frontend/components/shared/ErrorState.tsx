import { AlertCircle } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  details?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = 'Something went wrong',
  details,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--color-status-danger-bg)' }}
        >
          <AlertCircle className="h-6 w-6" style={{ color: 'var(--sos-status-danger)' }} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-semibold" style={{ color: 'var(--sos-text-primary)' }}>
            {message}
          </p>
          {details && (
            <p style={{ color: 'var(--sos-text-muted)', fontSize: 'var(--text-sm)' }}>{details}</p>
          )}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--sos-brand-primary)',
              color: 'var(--sos-text-inverse)',
            }}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
