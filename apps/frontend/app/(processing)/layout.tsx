import type { ReactNode } from 'react';
import { ProcessingShell } from '@/components/layout/ProcessingShell';

export default function ProcessingLayout({ children }: { children: ReactNode }) {
  return <ProcessingShell>{children}</ProcessingShell>;
}
