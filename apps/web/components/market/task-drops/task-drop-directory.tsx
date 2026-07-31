import type { Route } from 'next';
import type { TaskDropDirectoryItem } from '@taskmarket/shared';
import { ArrowRightIcon, InfoIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { TaskDropCard } from './task-drop-card';

function parseCursorStack(value?: string) {
  return value
    ?.split(',')
    .map((cursor) => cursor.trim())
    .filter(Boolean);
}

function directoryHref(input: { cursor?: string; cursorStack?: string }) {
  const params = new URLSearchParams();
  if (input.cursor) {
    params.set('cursor', input.cursor);
  }
  if (input.cursorStack) {
    params.set('cursorStack', input.cursorStack);
  }
  const query = params.toString();
  return `/dashboard/drops${query ? `?${query}` : ''}`;
}

function TaskDropPagination({
  currentCursor,
  cursorStack: serializedStack,
  nextCursor,
}: {
  currentCursor?: string;
  cursorStack?: string;
  nextCursor: string | null;
}) {
  if (!currentCursor && !nextCursor) {
    return null;
  }

  const cursorStack = parseCursorStack(serializedStack) ?? [];
  const currentPage = cursorStack.length + (currentCursor ? 2 : 1);
  const previousCursor = cursorStack.at(-1);
  const previousHref = currentCursor
    ? directoryHref({
        cursor: previousCursor,
        cursorStack: cursorStack.length > 1 ? cursorStack.slice(0, -1).join(',') : undefined,
      })
    : null;
  const nextHref = nextCursor
    ? directoryHref({
        cursor: nextCursor,
        cursorStack: currentCursor ? [...cursorStack, currentCursor].join(',') : undefined,
      })
    : null;

  return (
    <Pagination aria-label="Task Drop pagination" className="justify-end">
      <PaginationContent className="flex-wrap justify-center">
        {previousHref ? (
          <PaginationItem>
            <PaginationPrevious href={previousHref} />
          </PaginationItem>
        ) : null}
        <PaginationItem>
          <PaginationLink
            href={directoryHref({ cursor: currentCursor, cursorStack: serializedStack })}
            isActive
            size="default"
          >
            Page {currentPage}
          </PaginationLink>
        </PaginationItem>
        {nextHref ? (
          <PaginationItem>
            <PaginationNext href={nextHref} />
          </PaginationItem>
        ) : null}
      </PaginationContent>
    </Pagination>
  );
}

export function TaskDropDirectory({
  currentCursor,
  cursorStack,
  errorMessage,
  items,
  nextCursor,
}: {
  currentCursor?: string;
  cursorStack?: string;
  errorMessage?: string;
  items: TaskDropDirectoryItem[];
  nextCursor: string | null;
}) {
  const featuredDrop = items.find((item) => item.drop.isOfficial && item.availableTaskCount > 0);
  const gridItems = featuredDrop
    ? items.filter((item) => item.drop.id !== featuredDrop.drop.id)
    : items;

  return (
    <div className="task-drop-directory mx-auto grid w-full max-w-7xl gap-9 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="grid gap-6 border-b border-border/58 pb-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-primary">Task Drops</p>
          <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight sm:text-6xl">
            Task Drops
          </h1>
          <p className="mt-4 max-w-2xl border-l-2 border-primary pl-4 text-base leading-7 text-muted-foreground">
            Explore focused collections of funded tasks. Find a drop that matches your skills, then
            choose the work you want to take on.
          </p>
        </div>
        <Button asChild className="md:mb-1" variant="outline">
          <Link href={'/taskdrop' as Route}>
            <InfoIcon aria-hidden="true" />
            How Task Drops work
            <ArrowRightIcon
              aria-hidden="true"
              className="group-hover/button:translate-x-0.5 motion-reduce:transform-none"
            />
          </Link>
        </Button>
      </header>

      {errorMessage ? (
        <Card className="border-warning/46 bg-warning/8" role="alert">
          <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <h2 className="font-display text-xl font-semibold">Task Drops are out of reach</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{errorMessage}</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/dashboard/drops">Try again</Link>
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="border-primary/28 bg-primary/8">
          <CardContent className="grid min-h-48 place-content-center justify-items-center gap-3 text-center">
            <h2 className="font-display text-2xl font-semibold">No Task Drops are live yet</h2>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              New collections of funded work will appear here as publishers release them.
            </p>
            <Button asChild className="mt-1">
              <Link href="/dashboard/tasks/new">Post a task</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {featuredDrop ? (
            <section aria-label="Current official drop" className="grid gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-primary">
                  Featured
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">
                  Current official drop
                </h2>
              </div>
              <TaskDropCard featured item={featuredDrop} />
            </section>
          ) : null}

          <section aria-label="Browse Task Drops" className="grid gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                {featuredDrop ? 'More Task Drops' : 'Browse Task Drops'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Compare availability, rewards, and deadlines before opening a collection.
              </p>
            </div>
            {gridItems.length > 0 ? (
              <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {gridItems.map((item) => (
                  <li className="min-w-0" key={item.drop.id}>
                    <TaskDropCard className="h-full" item={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-border/58 bg-card/44 p-5 text-sm text-muted-foreground">
                More Task Drops will appear here as they go live.
              </p>
            )}
          </section>

          <TaskDropPagination
            currentCursor={currentCursor}
            cursorStack={cursorStack}
            nextCursor={nextCursor}
          />
        </>
      )}
    </div>
  );
}
