import type { GameCatalogItem } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CatalogExperience } from '@/components/catalog-experience';

function cover(fill: string, line: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img"><rect width="800" height="800" fill="${fill}"/><path d="M0 590 210 390l140 110 200-260 250 310v250H0Z" fill="${line}"/></svg>`
  )}`;
}

const games: GameCatalogItem[] = [
  {
    coverAltText: 'Geometric mountain cover art for Silent Orbit',
    coverUrl: cover('#293236', '#cfdbcc'),
    creatorName: 'North Field',
    description: 'Steer through a silent orbit.',
    downvoteCount: 1,
    id: 'orbit-1',
    netVotes: 18,
    publishedAt: '2026-08-16T00:00:00.000Z',
    slug: 'silent-orbit',
    tags: ['arcade', 'space'],
    title: 'Silent Orbit',
    upvoteCount: 19,
  },
  {
    coverAltText: 'Layered green cover art for Moss Puzzle',
    coverUrl: cover('#4f5b42', '#d9dfc3'),
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
    coverAltText: 'Machine cover art for Circuit Race',
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
  {
    coverAltText: 'Pink mountain cover art for Paper Lake',
    coverUrl: cover('#7d485d', '#e9cbd0'),
    creatorName: 'West Window',
    description: 'Fold a lake from loose paper.',
    downvoteCount: 6,
    id: 'lake-4',
    netVotes: -2,
    publishedAt: '2026-08-13T00:00:00.000Z',
    slug: 'paper-lake',
    tags: ['relaxing', 'paper'],
    title: 'Paper Lake',
    upvoteCount: 4,
  },
  {
    coverAltText: 'Blue mountain cover art for Solar Kites',
    coverUrl: cover('#3c5770', '#c4ddec'),
    creatorName: 'Harbor Signal',
    description: 'Catch wind across a bright bay.',
    downvoteCount: 1,
    id: 'kites-5',
    netVotes: 9,
    publishedAt: '2026-08-12T00:00:00.000Z',
    slug: 'solar-kites',
    tags: ['flying', 'arcade'],
    title: 'Solar Kites',
    upvoteCount: 10,
  },
  {
    coverAltText: 'Gold mountain cover art for Clockwork Pool',
    coverUrl: cover('#786431', '#f0e4ad'),
    creatorName: 'Low Key Studio',
    description: 'Set a mechanical pool table in motion.',
    downvoteCount: 3,
    id: 'pool-6',
    netVotes: 0,
    publishedAt: '2026-08-11T00:00:00.000Z',
    slug: 'clockwork-pool',
    tags: ['sports', 'physics'],
    title: 'Clockwork Pool',
    upvoteCount: 3,
  },
  {
    coverAltText: 'Purple mountain cover art for Tiny Garden',
    coverUrl: cover('#60506e', '#ddcee7'),
    creatorName: 'Garden Unit',
    description: 'Grow a tiny garden between turns.',
    downvoteCount: 0,
    id: 'garden-7',
    netVotes: 3,
    publishedAt: '2026-08-10T00:00:00.000Z',
    slug: 'tiny-garden',
    tags: ['garden', 'strategy'],
    title: 'Tiny Garden',
    upvoteCount: 3,
  },
  {
    coverAltText: 'Red mountain cover art for Red Shift',
    coverUrl: cover('#753d3d', '#edc6bd'),
    creatorName: 'North Field',
    description: 'Thread a fast line through red space.',
    downvoteCount: 2,
    id: 'shift-8',
    netVotes: 7,
    publishedAt: '2026-08-09T00:00:00.000Z',
    slug: 'red-shift',
    tags: ['racing', 'space'],
    title: 'Red Shift',
    upvoteCount: 9,
  },
];

const meta = {
  component: CatalogExperience,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Catalog/Catalog experience',
} satisfies Meta<typeof CatalogExperience>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/catalog-experience.tsx
export const Catalog: Story = {
  args: {
    initialQuery: '',
    result: { games, ok: true },
  },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByLabelText('Search games');

    await userEvent.type(search, 'garden');

    await expect(search).toHaveFocus();
    await expect(canvas.getByRole('link', { name: 'Play Moss Puzzle, score +4' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Play Tiny Garden, score +3' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: /Silent Orbit/ })).not.toBeInTheDocument();

    await userEvent.clear(search);

    await expect(canvas.getByText('Silent Orbit').closest('a')).toHaveAttribute(
      'href',
      '/games/silent-orbit'
    );
  },
};

export const Phone: Story = {
  args: Catalog.args,
  globals: {
    viewport: { value: 'phone', isRotated: false },
  },
};

export const Tablet: Story = {
  args: Catalog.args,
  globals: {
    viewport: { value: 'tablet', isRotated: false },
  },
};

export const Wide: Story = {
  args: Catalog.args,
  globals: {
    viewport: { value: 'wide', isRotated: false },
  },
};

export const Filtered: Story = {
  args: {
    initialQuery: 'garden',
    result: { games, ok: true },
  },
};

export const Empty: Story = {
  args: {
    initialQuery: '',
    result: { games: [], ok: true },
  },
};

export const EmptySearch: Story = {
  args: {
    initialQuery: 'missing',
    result: { games, ok: true },
  },
};

export const Unavailable: Story = {
  args: {
    initialQuery: '',
    result: { failure: { kind: 'unavailable', status: 503 }, ok: false },
  },
};

export const Light: Story = {
  args: Catalog.args,
  globals: {
    theme: 'light',
    viewport: { value: 'desktop', isRotated: false },
  },
};
