import type { ReactNode } from 'react';
import '../styles/globals.css';
import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { BackendWarmup } from '@/components/layout/BackendWarmup';
import { UploadDockHost } from '@/components/databank/UploadDockHost';
import { DemoBanner } from '@/components/layout/DemoBanner';

// Brand is a build-time value so the demo image (NEXT_PUBLIC_BRAND_NAME set)
// never shows the real tenant in the tab title; production keeps its default.
const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || 'Tashfeen';
export const metadata = {
  title: BRAND === 'Tashfeen' ? 'Tashfeen – Immigration Solutions' : `${BRAND} – CRM`,
  description: BRAND === 'Tashfeen' ? 'Tashfeen Immigration AI Platform' : `${BRAND} immigration CRM`,
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
          <DemoBanner />
          <BackendWarmup />
          <UploadDockHost />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
