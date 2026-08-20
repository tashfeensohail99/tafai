import type { ReactNode } from 'react';
import { HrShell } from '@/components/layout/HrShell';

export default function HrLayout({ children }: { children: ReactNode }) {
  return <HrShell>{children}</HrShell>;
}
