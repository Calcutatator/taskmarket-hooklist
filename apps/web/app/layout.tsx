import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';

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

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange enableSystem>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
