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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Manrope:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        <ThemeProvider>
          <BackendWarmup />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
