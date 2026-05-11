import type { ReactNode } from 'react';
import { EmployeeShell } from '@/components/layout/EmployeeShell';

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return <EmployeeShell>{children}</EmployeeShell>;
}