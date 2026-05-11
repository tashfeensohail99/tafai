import type { ReactNode } from 'react';
import { FinanceShell } from '@/components/layout/FinanceShell';

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <FinanceShell>{children}</FinanceShell>;
}
