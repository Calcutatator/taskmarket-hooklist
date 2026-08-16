import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';

import './globals.css';

import { Providers } from '@/app/providers';
import { getEnvironment } from '@/lib/environment';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
});

const environment = getEnvironment();

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
  applicationName: 'Slap-Chop Games',
  description: 'A curated catalog of playable Taskmarket games.',
  metadataBase: new URL(environment.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'Slap-Chop Games',
    template: '%s | Slap-Chop Games',
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: 'cover',
  width: 'device-width',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={instrumentSans.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
