import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  fullPage?: boolean;
}

export function LoadingState({ message = 'Loading...', fullPage = false }: LoadingStateProps) {
  if (fullPage) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: 'var(--sos-bg-app)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--sos-brand-primary)' }} />
          <p style={{ color: 'var(--sos-text-muted)', fontSize: 'var(--text-sm)' }}>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--sos-brand-primary)' }} />
        <p style={{ color: 'var(--sos-text-muted)', fontSize: 'var(--text-sm)' }}>{message}</p>
      </div>
    </div>
  );
}
