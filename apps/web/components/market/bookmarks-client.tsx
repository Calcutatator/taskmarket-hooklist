'use client';

// Implements: ADR-0096
// Implements: ADR-0100

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import { useAccount } from 'wagmi';

import { CopyButton } from '@/components/market/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/api/client';
import { useReadAuthSignatureState } from '@/lib/use-read-auth-signature';
import { useUrlState } from '@/lib/url-state/use-url-state';

/**
 * The saved list.
 *
 * Which collection is being viewed is shareable-tier state, so it lives in `?tab=` and nowhere
 * else -- a person sending "look at my Weather picks" sends the address of that filter, not of the
 * page. The new-collection name box is the one local value: it is an in-progress draft, which is
 * session/ephemeral by the ADR-0096 taxonomy rather than something a second person would need.
 */
export function BookmarksClient({ shareBaseUrl }: { shareBaseUrl: string }) {
  const { address, isConnected } = useAccount();
  const { ready } = useReadAuthSignatureState(address);
  const [activeCollection, setActiveCollection] = useUrlState('tab', { history: 'navigate' });
  const [newCollectionName, setNewCollectionName] = useState('');

  const enabled = isConnected && ready;
  const utils = trpc.useUtils();
  const collections = trpc.bookmarks.listCollections.useQuery(undefined, { enabled });
  const saved = trpc.bookmarks.list.useQuery(
    activeCollection ? { collectionId: activeCollection } : {},
    { enabled }
  );

  const invalidate = () => {
    void utils.bookmarks.list.invalidate();
    void utils.bookmarks.listCollections.invalidate();
  };
  const createCollection = trpc.bookmarks.createCollection.useMutation({ onSettled: invalidate });
  const publish = trpc.bookmarks.publishCollection.useMutation({ onSettled: invalidate });
  const unpublish = trpc.bookmarks.unpublishCollection.useMutation({ onSettled: invalidate });
  const remove = trpc.bookmarks.remove.useMutation({ onSettled: invalidate });

  if (!isConnected) {
    return (
      <p className="rounded-lg border border-border/58 bg-card/38 p-6 text-sm text-muted-foreground">
        Connect a wallet to see the things you have saved. Bookmarks are stored against your
        address, so they follow you to another browser or device.
      </p>
    );
  }

  const current = collections.data?.collections.find((entry) => entry.id === activeCollection);

  return (
    <div className="grid gap-6">
      <nav aria-label="Collections" className="flex flex-wrap items-center gap-2">
        <Button
          aria-current={activeCollection === '' ? 'page' : undefined}
          onClick={() => setActiveCollection('')}
          size="sm"
          type="button"
          variant={activeCollection === '' ? 'secondary' : 'ghost'}
        >
          All saved
        </Button>
        {collections.data?.collections.map((collection) => (
          <Button
            aria-current={activeCollection === collection.id ? 'page' : undefined}
            key={collection.id}
            onClick={() => setActiveCollection(collection.id)}
            size="sm"
            type="button"
            variant={activeCollection === collection.id ? 'secondary' : 'ghost'}
          >
            {collection.name}
          </Button>
        ))}
      </nav>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newCollectionName.trim();
          if (!name) return;
          createCollection.mutate({ name });
          setNewCollectionName('');
        }}
      >
        <Input
          aria-label="New collection name"
          className="max-w-xs"
          onChange={(event) => setNewCollectionName(event.target.value)}
          placeholder="New collection"
          value={newCollectionName}
        />
        <Button disabled={!newCollectionName.trim()} size="sm" type="submit" variant="outline">
          Create collection
        </Button>
      </form>

      {current ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/58 bg-card/38 p-4">
          {current.publishedSlug ? (
            <>
              <span className="text-sm text-muted-foreground">
                Shared. Anyone with the link sees the entries they already have access to.
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border/58 bg-muted/26 py-0.5 pl-2 pr-0.5 font-mono text-xs">
                {`${shareBaseUrl}/c/${current.publishedSlug}`}
                <CopyButton
                  label="Copy collection link"
                  text={`${shareBaseUrl}/c/${current.publishedSlug}`}
                />
              </span>
              <Button
                disabled={unpublish.isPending}
                onClick={() => unpublish.mutate({ collectionId: current.id })}
                size="sm"
                type="button"
                variant="ghost"
              >
                Stop sharing
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                Private. Sharing creates a link; it never grants access to anything in the list.
              </span>
              <Button
                disabled={publish.isPending}
                onClick={() => publish.mutate({ collectionId: current.id })}
                size="sm"
                type="button"
                variant="outline"
              >
                Share collection
              </Button>
            </>
          )}
        </div>
      ) : null}

      {saved.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading saved items…</p>
      ) : saved.data && saved.data.bookmarks.length > 0 ? (
        <ul className="grid gap-2">
          {saved.data.bookmarks.map((bookmark) => (
            <li
              className="flex items-center justify-between gap-3 rounded-lg border border-border/58 bg-card/38 p-4"
              key={bookmark.id}
            >
              <Link
                className="min-w-0 truncate font-medium text-foreground underline-offset-4 hover:underline"
                href={
                  (bookmark.entityType === 'agent'
                    ? `/dashboard/agents/${encodeURIComponent(bookmark.entityId)}`
                    : `/dashboard/tasks/${encodeURIComponent(bookmark.entityId)}`) as Route
                }
              >
                {bookmark.entityType === 'agent' ? 'Agent' : 'Task'} {bookmark.entityId}
              </Link>
              <Button
                aria-label={`Remove saved ${bookmark.entityType} ${bookmark.entityId}`}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate({
                    entityId: bookmark.entityId,
                    entityType: bookmark.entityType as 'submission' | 'task' | 'agent',
                  })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border/58 bg-card/38 p-6 text-sm text-muted-foreground">
          {activeCollection
            ? 'Nothing in this collection yet.'
            : 'Nothing saved yet. Use the bookmark control on a task to keep it here.'}
        </p>
      )}
    </div>
  );
}
