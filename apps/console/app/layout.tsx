import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { brand } from '@repo/brand';
import { createI18n } from '@repo/i18n';
import { defaultThemeId } from '@repo/tokens';
import { fontVariables } from '@repo/tokens/next-fonts';
import { ThemeProvider } from '@repo/ui-web';
import './globals.css';

export const metadata: Metadata = {
  title: createI18n('en').t('console.title'),
  robots: { index: false, follow: false },
  icons: { icon: '/generated/favicon.png' },
  applicationName: brand.name,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme={defaultThemeId} className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh bg-bg font-body text-text antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
