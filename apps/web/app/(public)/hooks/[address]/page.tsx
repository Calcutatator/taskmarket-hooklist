import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { HookInspection } from '@/components/market/hook-inspection';
import { ApiConnectionError, fetchHook } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';
import type { PublicHook } from '@/lib/hooklist';

type HookPageProps = { params: Promise<{ address: string }> };
const hookAddressPattern = /^0x(?!0{40}$)[a-fA-F0-9]{40}$/;

export async function generateMetadata({ params }: HookPageProps): Promise<Metadata> {
  const { address } = await params;
  const canonicalAddress = address.toLowerCase();
  return buildPageMetadata({
    description: 'An observed Taskmarket lifecycle hook address and its public task references.',
    path: `/hooks/${encodeURIComponent(canonicalAddress)}`,
    title: 'Observed Taskmarket hook',
  });
}

export default async function HookPage({ params }: HookPageProps) {
  const { address } = await params;
  if (!hookAddressPattern.test(address)) notFound();
  const canonicalAddress = address.toLowerCase();
  if (address !== canonicalAddress) permanentRedirect(`/hooks/${canonicalAddress}`);

  let hook: PublicHook | null = null;
  let errorMessage: string | undefined;
  try {
    hook = await fetchHook(canonicalAddress);
  } catch (error) {
    if (!(error instanceof ApiConnectionError)) throw error;
    errorMessage = 'The public market API is unavailable. Try again shortly.';
  }
  if (!hook && !errorMessage) notFound();

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <HookInspection errorMessage={errorMessage} hook={hook} />
    </div>
  );
}
