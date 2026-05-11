import type { ReactNode } from 'react';

// Auth layout — full bleed; the login page renders its own split layout
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
