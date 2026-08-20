'use client';

// Implements: ADR-0100

import { BookmarkIcon } from 'lucide-react';
import { useAccount } from 'wagmi';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api/client';
import { useReadAuthSignatureState } from '@/lib/use-read-auth-signature';

type BookmarkEntity = 'submission' | 'task' | 'agent';

/**
 * Save something to come back to.
 *
 * Requires a connected wallet, and says so rather than failing quietly or writing to a local
 * store that would later need reconciling -- the half-measure ADR-0100 rejects, since the whole
 * point is a list that survives a change of device.
 *
 * The toggle is optimistic because the write is small and the latency is visible; a failure rolls
 * back rather than leaving the control lying about what is saved.
 */
export function BookmarkButton({
  entityId,
  entityType,
  label = 'Bookmark',
}: {
  entityId: string;
  entityType: BookmarkEntity;
  label?: string;
}) {
  const { address, isConnected } = useAccount();
  const { ready } = useReadAuthSignatureState(address);
  const utils = trpc.useUtils();

  // Only ask once the wallet has actually proved ownership: without the read-auth header the
  // query is refused, and firing it anyway would show every connected-but-unsigned viewer an
  // error for something they did not do.
  const list = trpc.bookmarks.list.useQuery(
    { entityType },
    { enabled: isConnected && ready, staleTime: 30_000 }
  );

  const isBookmarked = Boolean(
    list.data?.bookmarks.some((bookmark) => bookmark.entityId === entityId)
  );

  const invalidate = () => utils.bookmarks.list.invalidate();
  const add = trpc.bookmarks.add.useMutation({ onSettled: invalidate });
  const remove = trpc.bookmarks.remove.useMutation({ onSettled: invalidate });
  const pending = add.isPending || remove.isPending;

  if (!isConnected) {
    return (
      <Button aria-label={`${label} (connect a wallet to save)`} disabled size="sm" variant="ghost">
        <BookmarkIcon aria-hidden="true" />
        <span className="hidden sm:inline">Connect to save</span>
      </Button>
    );
  }

  return (
    <Button
      aria-label={isBookmarked ? `Remove ${label.toLowerCase()}` : label}
      aria-pressed={isBookmarked}
      disabled={pending || !ready}
      onClick={() => {
        if (isBookmarked) {
          remove.mutate({ entityId, entityType });
        } else {
          add.mutate({ entityId, entityType });
        }
      }}
      size="sm"
      type="button"
      variant={isBookmarked ? 'secondary' : 'ghost'}
    >
      <BookmarkIcon aria-hidden="true" fill={isBookmarked ? 'currentColor' : 'none'} />
      <span className="hidden sm:inline">{isBookmarked ? 'Saved' : label}</span>
    </Button>
  );
}
