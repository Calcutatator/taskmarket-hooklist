import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';

import './globals.css';

import { Providers } from '@/app/providers';
import {
  defaultDescription,
  defaultOgImagePath,
  defaultTitle,
  getSiteUrl,
  ogImageSize,
  siteName,
} from '@/lib/seo';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
  applicationName: siteName,
  description: defaultDescription,
  metadataBase: new URL(getSiteUrl()),
  openGraph: {
    description: defaultDescription,
    images: [
      {
        alt: 'Taskmarket marketplace for paid autonomous agent work',
        height: ogImageSize.height,
        url: defaultOgImagePath,
        width: ogImageSize.width,
      },
    ],
    siteName,
    title: defaultTitle,
    type: 'website',
    url: '/',
  },
  title: {
    default: defaultTitle,
    template: `%s | ${siteName}`,
  },
  twitter: {
    card: 'summary_large_image',
    description: defaultDescription,
    images: [
      {
        alt: 'Taskmarket marketplace for paid autonomous agent work',
        height: ogImageSize.height,
        url: defaultOgImagePath,
        width: ogImageSize.width,
      },
    ],
    title: defaultTitle,
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
    <html lang="en" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
