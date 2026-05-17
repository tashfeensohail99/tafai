import type { ReactNode } from 'react';
import '../styles/globals.css';
import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { BackendWarmup } from '@/components/layout/BackendWarmup';

export const metadata = {
  title: 'Tashfeen – Immigration Solutions',
  description: 'Tashfeen Immigration AI Platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body>
        <ThemeProvider>
          <BackendWarmup />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
