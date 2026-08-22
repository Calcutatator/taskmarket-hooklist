import type { Metadata } from 'next';

import { HookBuilder } from '@/components/market/hooklist';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Configure Taskmarket hook callbacks and generate a Solidity scaffold with a versioned manifest.',
  path: '/hooks/build',
  title: 'Build a Taskmarket hook',
});

type HookBuilderPageProps = { searchParams: Promise<{ address?: string }> };

export default async function HookBuilderPage({ searchParams }: HookBuilderPageProps) {
  const { address } = await searchParams;
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <HookBuilder observedAddress={address} />
    </div>
  );
}
