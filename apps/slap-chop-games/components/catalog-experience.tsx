'use client';

import type { GameCatalogItem, GameVoteResponse } from '@taskmarket/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { GameCover } from '@/components/game-cover';
import { GameVoteControl } from '@/components/game-vote-control';
import type { CatalogReadFailure, CatalogReadResult } from '@/lib/catalog-api';
import {
  consumeCatalogReturnScroll,
  getCatalogHref,
  rememberGameLaunch,
} from '@/lib/game-navigation';

type CatalogExperienceProps = {
  initialQuery: string;
  result: CatalogReadResult;
};

function normalizedSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

function catalogSearchText(game: GameCatalogItem): string {
  return [
    game.title,
    game.description ?? '',
    game.taskDescription ?? '',
    game.creatorName ?? '',
    ...game.tags,
  ]
    .join('\n')
    .toLowerCase();
}

// Verifies: ADR-0090. Filtering retains the snapshot sequence supplied by the backend.
export function filterCatalogGames(
  games: readonly GameCatalogItem[],
  query: string
): GameCatalogItem[] {
  const term = normalizedSearchTerm(query);

  if (!term) {
    return [...games];
  }

  return games.filter((game) => catalogSearchText(game).includes(term));
}

export function getGameHref(slug: string, query: string): Route {
  const normalizedQuery = query.trim();

  return (
    normalizedQuery
      ? `/games/${encodeURIComponent(slug)}?q=${encodeURIComponent(normalizedQuery)}`
      : `/games/${encodeURIComponent(slug)}`
  ) as Route;
}

function getUrlQuery(): string {
  return new URL(window.location.href).searchParams.get('q')?.trim().slice(0, 120) ?? '';
}

function updateUrlQuery(query: string, mode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  const normalizedQuery = query.trim().slice(0, 120);

  if (normalizedQuery) {
    url.searchParams.set('q', normalizedQuery);
  } else {
    url.searchParams.delete('q');
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`;

  if (mode === 'push') {
    window.history.pushState(null, '', nextPath);
  } else {
    window.history.replaceState(null, '', nextPath);
  }
}

function SearchRail({
  onQueryChange,
  query,
}: Readonly<{
  onQueryChange: (query: string) => void;
  query: string;
}>) {
  const hasCreatedHistoryEntry = useRef(false);

  useEffect(() => {
    function resetHistoryEntry() {
      hasCreatedHistoryEntry.current = false;
    }

    window.addEventListener('popstate', resetHistoryEntry);

    return () => window.removeEventListener('popstate', resetHistoryEntry);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <form
      action="/"
      className="flex min-w-0 flex-1 items-center border-l border-catalog-border"
      method="get"
      onSubmit={handleSubmit}
      role="search"
    >
      <label className="sr-only" htmlFor="catalog-search">
        Search games
      </label>
      <input
        aria-controls="catalog-results"
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-catalog-ink placeholder:text-catalog-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-catalog-focus"
        id="catalog-search"
        name="q"
        onChange={(event) => {
          const nextQuery = event.target.value;
          const historyMode = hasCreatedHistoryEntry.current ? 'replace' : 'push';

          hasCreatedHistoryEntry.current = true;
          onQueryChange(nextQuery);
          updateUrlQuery(nextQuery, historyMode);
        }}
        placeholder="Search games"
        type="search"
        value={query}
      />
    </form>
  );
}

function getScoreLabel(netVotes: number): string {
  return netVotes > 0 ? `+${netVotes}` : String(netVotes);
}

function CatalogGameTile({
  game,
  index,
  onPlay,
  query,
}: Readonly<{
  game: GameCatalogItem;
  index: number;
  onPlay: (event: MouseEvent<HTMLAnchorElement>, slug: string) => void;
  query: string;
}>) {
  const [vote, setVote] = useState<
    Pick<GameVoteResponse, 'downvoteCount' | 'netVotes' | 'upvoteCount'>
  >(() => ({
    downvoteCount: game.downvoteCount,
    netVotes: game.netVotes,
    upvoteCount: game.upvoteCount,
  }));
  const priorGameId = useRef(game.id);

  useEffect(() => {
    if (priorGameId.current === game.id) {
      return;
    }

    priorGameId.current = game.id;
    setVote({
      downvoteCount: game.downvoteCount,
      netVotes: game.netVotes,
      upvoteCount: game.upvoteCount,
    });
  }, [game.downvoteCount, game.id, game.netVotes, game.upvoteCount]);

  const score = getScoreLabel(vote.netVotes);
  const coverAltText = game.coverAltText ?? `Cover art for ${game.title}`;

  return (
    <li className="relative aspect-square min-w-0 bg-catalog-surface">
      <Link
        aria-label={`Play ${game.title}, score ${score}`}
        className="group grid h-full min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-catalog-surface text-catalog-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-catalog-focus"
        href={getGameHref(game.slug, query)}
        onClick={(event) => onPlay(event, game.slug)}
      >
        <GameCover
          alt={coverAltText}
          coverUrl={game.coverUrl}
          priority={index < 8}
          title={game.title}
        />
        <span className="flex min-h-11 min-w-0 items-center gap-2 border-t border-catalog-border bg-catalog-canvas/90 px-2 py-1.5 pr-20 text-xs leading-4">
          <span className="min-w-0 flex-1 truncate font-medium">{game.title}</span>
          <span aria-label={`${score} net votes`} className="shrink-0 font-mono text-catalog-muted">
            {score}
          </span>
        </span>
      </Link>
      <div className="absolute bottom-1.5 right-2 z-10">
        <GameVoteControl
          gameId={game.id}
          initialDownvoteCount={vote.downvoteCount}
          initialUpvoteCount={vote.upvoteCount}
          onVoteChange={({ downvoteCount, netVotes, upvoteCount }) => {
            setVote({ downvoteCount, netVotes, upvoteCount });
          }}
          title={game.title}
        />
      </div>
    </li>
  );
}

function CatalogGrid({ games, query }: Readonly<{ games: GameCatalogItem[]; query: string }>) {
  function rememberLaunch(event: MouseEvent<HTMLAnchorElement>, slug: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    rememberGameLaunch({ query, slug });
  }

  return (
    <>
      <h1 className="sr-only">Slap-Chop Games catalog</h1>
      <p aria-live="polite" className="sr-only" role="status">
        {query
          ? `${games.length} game${games.length === 1 ? '' : 's'} match ${query}`
          : `${games.length} game${games.length === 1 ? '' : 's'} in the catalog`}
      </p>
      <ul
        aria-label={query ? `Games matching ${query}` : 'Games by popularity'}
        className="grid grid-cols-2 gap-px bg-catalog-border md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8"
        id="catalog-results"
      >
        {games.map((game, index) => (
          <CatalogGameTile
            game={game}
            index={index}
            key={game.id}
            onPlay={rememberLaunch}
            query={query}
          />
        ))}
      </ul>
    </>
  );
}

function EmptyCatalog({ query }: Readonly<{ query: string }>) {
  const hasSearch = Boolean(query.trim());

  return (
    <section
      aria-labelledby="catalog-empty-title"
      className="grid min-h-[calc(100dvh-2.75rem)] place-items-center p-4"
      id="catalog-results"
    >
      <div className="max-w-sm border border-catalog-border bg-catalog-surface p-4">
        <h1
          className="text-2xl font-semibold tracking-tight text-catalog-ink"
          id="catalog-empty-title"
        >
          {hasSearch ? 'No games match this search.' : 'No games published yet.'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-catalog-muted">
          {hasSearch
            ? 'Try a title, creator, or tag from the catalog.'
            : 'Curated Taskmarket games will appear here once the catalog is ready.'}
        </p>
      </div>
    </section>
  );
}

function CatalogError({ failure }: Readonly<{ failure: CatalogReadFailure }>) {
  const message =
    failure.kind === 'catalog_limit'
      ? 'The catalog has more games than this release can load.'
      : failure.kind === 'invalid_response'
        ? 'The catalog response could not be read.'
        : 'The catalog cannot reach Taskmarket right now.';

  return (
    <section
      aria-labelledby="catalog-error-title"
      className="grid min-h-[calc(100dvh-2.75rem)] place-items-center p-4"
      id="catalog-results"
    >
      <div className="max-w-sm border border-catalog-border bg-catalog-surface p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-catalog-muted">
          Unavailable
        </p>
        <h1
          className="mt-3 text-2xl font-semibold tracking-tight text-catalog-ink"
          id="catalog-error-title"
        >
          The catalog paused.
        </h1>
        <p className="mt-2 text-sm leading-6 text-catalog-muted">{message}</p>
      </div>
    </section>
  );
}

// Implements: ADR-0090. It renders the backend's catalog order and only filters that snapshot.
export function CatalogExperience({ initialQuery, result }: Readonly<CatalogExperienceProps>) {
  const [query, setQuery] = useState(initialQuery);
  const games = result.ok ? result.games : [];
  const visibleGames = useMemo(() => filterCatalogGames(games, query), [games, query]);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    function handlePopState() {
      setQuery(getUrlQuery());
    }

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const scrollY = consumeCatalogReturnScroll(getCatalogHref(query));

    if (scrollY === null) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ behavior: 'auto', top: scrollY });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [query]);

  return (
    <AppShell rail={<SearchRail onQueryChange={setQuery} query={query} />}>
      {result.ok ? (
        visibleGames.length ? (
          <CatalogGrid games={visibleGames} query={query} />
        ) : (
          <EmptyCatalog query={query} />
        )
      ) : (
        <CatalogError failure={result.failure} />
      )}
    </AppShell>
  );
}
