import type { ReactNode } from 'react';
import '../styles/globals.css';
import { ThemeProvider } from '@/components/layout/ThemeProvider';

export const metadata = {
  title: 'Tafsheen – Immigration Solutions',
  description: 'Tafsheen Immigration AI Platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
