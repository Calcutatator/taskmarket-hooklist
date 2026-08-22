import type { Metadata } from 'next';

import { HooklistDirectory } from '@/components/market/hooklist';
import { ApiConnectionError, fetchHookIndex } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';
import type { PublicHook } from '@/lib/hooklist';

export const metadata: Metadata = buildPageMetadata({
  description: 'Discover lifecycle hook addresses observed on public Taskmarket tasks.',
  path: '/hooks',
  title: 'Hooklist',
});

export default async function HooksPage() {
  let hooks: PublicHook[] = [];
  let hasMore = false;
  let errorMessage: string | undefined;
  try {
    const response = await fetchHookIndex();
    hooks = response.hooks;
    hasMore = response.hasMore;
  } catch (error) {
    if (!(error instanceof ApiConnectionError)) throw error;
    errorMessage = 'The public market API is unavailable. Try again shortly.';
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <HooklistDirectory errorMessage={errorMessage} hasMore={hasMore} hooks={hooks} />
    </div>
  );
}
