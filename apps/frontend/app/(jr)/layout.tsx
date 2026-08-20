import type { ReactNode } from 'react';
import { JrShell } from '@/components/layout/JrShell';

export default function JrLayout({ children }: { children: ReactNode }) {
  return <JrShell>{children}</JrShell>;
}
