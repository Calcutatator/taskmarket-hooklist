// Implements: ADR-0100

import type { Metadata } from 'next';

import { BookmarksClient } from '@/components/market/bookmarks-client';
import { buildPageMetadata, getSiteUrl } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description: 'Everything you have saved, and the collections you have shared.',
  path: '/dashboard/bookmarks',
  title: 'Saved',
});

/**
 * The saved list.
 *
 * A thin server shell: the list itself is wallet-scoped and authenticated, so it cannot be
 * server-rendered without the caller's read-auth signature, and the interactive leaf owns it. The
 * share base URL is resolved here so the client does not have to guess the deployment's origin.
 */
export default function BookmarksPage() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="grid gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          Saved
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          Saved against your wallet address, so the list is there on another browser or device.
        </p>
      </header>
      <BookmarksClient shareBaseUrl={getSiteUrl()} />
    </div>
  );
}
