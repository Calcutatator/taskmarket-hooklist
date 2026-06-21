import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityFeedResponse } from '@taskmarket/shared';

import { NewsClient } from './news-client';

const { queryState } = vi.hoisted(() => ({
  queryState: {
    value: {
      data: undefined as unknown,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    stats: {
      activityFeed: {
        useInfiniteQuery: () => queryState.value,
      },
    },
  },
}));

// The personal-queue tab is inactive by default; stub it so the test never
// reaches its REST fetch.
vi.mock('@/components/market/inbox-client', () => ({
  InboxClient: () => <div data-testid="inbox-client" />,
}));

vi.mock('@/components/market/motion/relative-time', () => ({
  RelativeTime: ({ value }: { value: string }) => <span>{value}</span>,
}));

const emptyFeed: ActivityFeedResponse = { items: [], nextCursor: null };

function setQuery(overrides: Partial<typeof queryState.value>) {
  queryState.value = { ...queryState.value, ...overrides };
}

describe('NewsClient market news', () => {
  beforeEach(() => {
    setQuery({
      data: undefined,
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('shows a retry-able error state when the feed query fails', () => {
    setQuery({ isError: true });
    render(<NewsClient initialFeed={emptyFeed} />);

    expect(screen.getByText(/could not load the news feed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // The error state must NOT be confused with the empty state.
    expect(screen.queryByText(/no activity yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when there is no activity and no error', () => {
    setQuery({ data: { pages: [emptyFeed], pageParams: [undefined] } });
    render(<NewsClient initialFeed={emptyFeed} />);

    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not load the news feed/i)).not.toBeInTheDocument();
  });

  it('renders feed rows when activity is returned', () => {
    setQuery({
      data: {
        pageParams: [undefined],
        pages: [
          {
            items: [
              {
                actor: '0x1111111111111111111111111111111111111111',
                actorType: 'human' as const,
                amount: '240000000',
                rating: null,
                taskId: 'task-1',
                taskTitle: 'Ship a typed parser.',
                timestamp: new Date('2026-06-21T00:00:00Z').toISOString(),
                type: 'task_created' as const,
              },
            ],
            nextCursor: null,
          },
        ],
      },
    });
    render(<NewsClient initialFeed={emptyFeed} />);

    expect(screen.getByText('Ship a typed parser.')).toBeInTheDocument();
    expect(screen.getByTestId('market-news-list')).toBeInTheDocument();
  });
});
