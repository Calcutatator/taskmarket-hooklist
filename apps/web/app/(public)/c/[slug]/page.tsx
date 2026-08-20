// Implements: ADR-0100

import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getServerApiBaseUrl } from '@/lib/api/config';

type CollectionPageProps = {
  params: Promise<{ slug: string }>;
};

type CollectionEntry = {
  entityId: string;
  entityType: 'submission' | 'task' | 'agent';
  note: string | null;
};

export const metadata: Metadata = {
  // Two viewers legitimately see different entries at this URL, since each is resolved under
  // their own permissions. Indexing it would publish whatever the crawler happened to be allowed
  // to see as though it were the collection.
  robots: { follow: false, index: false },
};

async function fetchCollection(
  slug: string
): Promise<{ name: string; entries: CollectionEntry[] } | null> {
  const response = await fetch(
    `${getServerApiBaseUrl()}/trpc/bookmarks.collectionBySlug?input=${encodeURIComponent(
      JSON.stringify({ slug })
    )}`,
    // Never shared between viewers: the response depends on who is asking, so a shared cache
    // would hand one viewer another's permitted view.
    { cache: 'no-store' }
  );

  if (!response.ok) return null;
  const body = (await response.json()) as {
    result?: { data?: { name: string; entries: CollectionEntry[] } };
  };
  return body.result?.data ?? null;
}

/**
 * A published bookmark collection.
 *
 * The list is curated by its owner; what a viewer actually sees is resolved under their own
 * permissions by the backend, and anything they may not see is simply absent. There is
 * deliberately no "some items hidden" notice: a count would confirm the existence and volume of
 * work the viewer is not permitted to know about.
 */
export default async function PublishedCollectionPage({ params }: CollectionPageProps) {
  const { slug } = await params;
  const collection = await fetchCollection(slug);

  if (!collection) {
    notFound();
  }

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-10 sm:px-6">
      <header className="grid gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {collection.name}
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          A shared collection. You are seeing the entries you have access to.
        </p>
      </header>

      {collection.entries.length === 0 ? (
        <p className="rounded-lg border border-border/58 bg-card/38 p-6 text-sm text-muted-foreground">
          Nothing here you can view.
        </p>
      ) : (
        <ul className="grid gap-2">
          {collection.entries.map((entry) => (
            <li
              className="rounded-lg border border-border/58 bg-card/38 p-4 shadow-[var(--shadow-soft)]"
              key={`${entry.entityType}:${entry.entityId}`}
            >
              <Link
                className="font-medium text-foreground underline-offset-4 hover:underline"
                href={
                  (entry.entityType === 'agent'
                    ? `/agents/${encodeURIComponent(entry.entityId)}`
                    : `/tasks/${encodeURIComponent(entry.entityId)}`) as Route
                }
              >
                {entry.entityType === 'agent' ? 'Agent' : 'Task'} {entry.entityId}
              </Link>
              {entry.note ? (
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{entry.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
