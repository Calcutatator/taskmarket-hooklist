import type { GameCatalogItem } from '@taskmarket/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { CatalogExperience, filterCatalogGames, getGameHref } from './catalog-experience';
import { claimGameLaunch, prepareGameReturn } from '@/lib/game-navigation';

const games: GameCatalogItem[] = [
  {
    coverAltText: 'Orbit cover art',
    coverUrl: 'https://covers.taskmarket.dev/orbit.webp',
    creatorName: 'North Field',
    description: 'Steer through a silent orbit.',
    downvoteCount: 1,
    id: 'orbit-1',
    netVotes: 18,
    publishedAt: '2026-08-16T00:00:00.000Z',
    slug: 'silent-orbit',
    tags: ['arcade', 'space'],
    taskDescription: 'Navigate a moonlit pinball table.',
    title: 'Silent Orbit',
    upvoteCount: 19,
  },
  {
    coverAltText: 'Moss cover art',
    coverUrl: 'https://covers.taskmarket.dev/moss.webp',
    creatorName: 'Garden Unit',
    description: 'Build a puzzle garden.',
    downvoteCount: 2,
    id: 'moss-2',
    netVotes: 4,
    publishedAt: '2026-08-15T00:00:00.000Z',
    slug: 'moss-puzzle',
    tags: ['puzzle', 'garden'],
    title: 'Moss Puzzle',
    upvoteCount: 6,
  },
  {
    coverAltText: null,
    coverUrl: null,
    creatorName: 'Arc Workshop',
    description: 'A race around old machinery.',
    downvoteCount: 0,
    id: 'circuit-3',
    netVotes: 1,
    publishedAt: '2026-08-14T00:00:00.000Z',
    slug: 'circuit-race',
    tags: ['racing'],
    title: 'Circuit Race',
    upvoteCount: 1,
  },
];

// Verifies: ADR-0090
describe('CatalogExperience', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
  });

  it('keeps the server ordering while filtering catalog metadata locally', () => {
    expect(filterCatalogGames(games, 'a').map((game) => game.id)).toEqual([
      'orbit-1',
      'moss-2',
      'circuit-3',
    ]);
    expect(filterCatalogGames(games, 'Garden Unit').map((game) => game.id)).toEqual(['moss-2']);
    expect(filterCatalogGames(games, 'space').map((game) => game.id)).toEqual(['orbit-1']);
    expect(filterCatalogGames(games, 'moonlit').map((game) => game.id)).toEqual(['orbit-1']);
  });

  it('renders title, score, and a query-preserving game route for each tile', () => {
    render(<CatalogExperience initialQuery="orbit" result={{ games, ok: true }} />);

    const orbitLink = screen.getByRole('link', { name: 'Play Silent Orbit, score +18' });
    const orbitUpvote = screen.getByRole('button', { name: 'Upvote Silent Orbit' });

    expect(orbitLink).toHaveAttribute('href', '/games/silent-orbit?q=orbit');
    expect(orbitLink).not.toContainElement(orbitUpvote);
    expect(screen.getByText('Silent Orbit').closest('a')).toBe(orbitLink);
    expect(screen.getByText('+18').closest('a')).toBe(orbitLink);
    expect(screen.getByText('+18')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Moss Puzzle/ })).not.toBeInTheDocument();
  });

  it('does not leave a player return marker for a modified tile click', () => {
    render(<CatalogExperience initialQuery="orbit" result={{ games, ok: true }} />);

    fireEvent.click(screen.getByRole('link', { name: 'Play Silent Orbit, score +18' }), {
      ctrlKey: true,
    });
    window.history.pushState(null, '', '/games/silent-orbit?q=orbit');
    claimGameLaunch('silent-orbit');

    expect(prepareGameReturn('silent-orbit')).toEqual({
      href: '/',
      kind: 'fallback',
    });
  });

  it('updates the query state instantly and restores it on browser navigation', async () => {
    render(<CatalogExperience initialQuery="" result={{ games, ok: true }} />);

    const search = within(screen.getByRole('search')).getByLabelText('Search games');

    fireEvent.change(search, { target: { value: 'puzzle' } });

    expect(screen.getByRole('link', { name: 'Play Moss Puzzle, score +4' })).toBeVisible();
    expect(window.location.search).toBe('?q=puzzle');

    window.history.pushState(null, '', '/?q=orbit');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => expect(search).toHaveValue('orbit'));
    expect(screen.getByRole('link', { name: 'Play Silent Orbit, score +18' })).toBeVisible();
  });

  it('renders clear empty and unavailable states', () => {
    const { rerender } = render(
      <CatalogExperience initialQuery="missing" result={{ games, ok: true }} />
    );

    expect(screen.getByRole('heading', { name: 'No games match this search.' })).toBeVisible();

    rerender(
      <CatalogExperience
        initialQuery=""
        result={{ failure: { kind: 'unavailable', status: 503 }, ok: false }}
      />
    );

    expect(screen.getByRole('heading', { name: 'The catalog paused.' })).toBeVisible();
    expect(screen.getByText('The catalog cannot reach Taskmarket right now.')).toBeVisible();
  });
});

describe('getGameHref', () => {
  it('keeps a catalog query on play navigation', () => {
    expect(getGameHref('silent-orbit', 'orbit time')).toBe('/games/silent-orbit?q=orbit%20time');
    expect(getGameHref('silent-orbit', '')).toBe('/games/silent-orbit');
  });
});
