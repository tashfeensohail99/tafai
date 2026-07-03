import type { ReactNode } from 'react';
import { ReceptionShell } from '@/components/layout/ReceptionShell';

export default function ReceptionLayout({ children }: { children: ReactNode }) {
  return <ReceptionShell>{children}</ReceptionShell>;
}
