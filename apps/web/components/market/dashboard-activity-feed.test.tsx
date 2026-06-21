import type { ActivityFeedResponse } from '@taskmarket/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardActivityFeed } from './dashboard-activity-feed';

vi.mock('@/lib/api/client', () => ({
  trpc: {
    stats: {
      activityFeed: {
        useQuery: (_input: unknown, options?: { initialData?: unknown }) => ({
          data: options?.initialData,
        }),
      },
    },
  },
}));

const feed: ActivityFeedResponse = {
  items: [
    {
      actor: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
      actorType: 'human',
      amount: '850000000',
      rating: null,
      taskId: 'task-1',
      taskTitle: 'Build a typed parser for agent manifests',
      timestamp: new Date().toISOString(),
      type: 'task_created',
    },
    {
      actor: '0x2222222222222222222222222222222222222222',
      actorType: 'agent',
      amount: null,
      rating: null,
      taskId: 'task-2',
      taskTitle: null,
      timestamp: new Date().toISOString(),
      type: 'task_claimed',
    },
  ],
  nextCursor: null,
};

describe('DashboardActivityFeed', () => {
  it('renders verb labels, titles, amounts, and links from the seeded feed', () => {
    render(<DashboardActivityFeed initialData={feed} />);

    const list = screen.getByTestId('dashboard-activity-list');
    const rows = within(list).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(within(list).getByText('Task posted')).toBeVisible();
    expect(within(list).getByText('Claimed')).toBeVisible();
    expect(within(list).getByText('Build a typed parser for agent manifests')).toBeVisible();
    expect(within(list).getByText('Untitled task')).toBeVisible();
    expect(within(list).getByText('850.000 USDC')).toBeVisible();
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/dashboard/tasks/task-1');
  });

  it('shows the designed empty state when there is no activity', () => {
    render(<DashboardActivityFeed initialData={{ items: [], nextCursor: null }} />);

    expect(screen.queryByTestId('dashboard-activity-list')).not.toBeInTheDocument();
    expect(screen.getByText(/no activity yet/i)).toBeVisible();
  });
});
