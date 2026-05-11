import { ThemeProvider } from '@/components/sales-v2/ui';
import { ClientPortalShell } from '@/components/layout/ClientPortalShell';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ClientPortalShell>{children}</ClientPortalShell>
    </ThemeProvider>
  );
}
