import type { TaskDropDirectoryItem } from '@taskmarket/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskDropDirectory } from './task-drop-directory';

function directoryItem(
  id: string,
  name: string,
  options: { availableTaskCount?: number; isOfficial?: boolean } = {}
): TaskDropDirectoryItem {
  return {
    availableTaskCount: options.availableTaskCount ?? 2,
    drop: {
      announcedAt: '2026-07-02T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      description: `${name} work.`,
      id,
      isOfficial: options.isOfficial ?? false,
      name,
      officialWalletAddress: '0x1111111111111111111111111111111111111111',
      ownerAddress: '0x1111111111111111111111111111111111111111',
    },
    latestTaskAt: '2026-07-03T00:00:00.000Z',
    nextExpiryTime: '2099-07-09T00:00:00.000Z',
    resolvedTaskCount: 1,
    taskCount: 3,
    totalReward: '6000000',
  };
}

describe('TaskDropDirectory', () => {
  it('features the current official drop once and grids the remaining drops', () => {
    render(
      <TaskDropDirectory
        items={[
          directoryItem('official', 'Official launch', { isOfficial: true }),
          directoryItem('community', 'Community research'),
        ]}
        nextCursor={null}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Task Drops' })).toBeVisible();
    expect(screen.getByRole('link', { name: /how Task Drops work/i })).toHaveAttribute(
      'href',
      '/taskdrop'
    );

    const featured = screen.getByRole('region', { name: 'Current official drop' });
    expect(
      within(featured).getByRole('link', { name: /Official launch Task Drop/i })
    ).toBeVisible();

    const directory = screen.getByRole('region', { name: 'Browse Task Drops' });
    expect(
      within(directory).getByRole('link', { name: /Community research Task Drop/i })
    ).toBeVisible();
    expect(
      within(directory).queryByRole('link', { name: /Official launch Task Drop/i })
    ).not.toBeInTheDocument();
  });

  it('shows a recoverable unavailable state', () => {
    render(
      <TaskDropDirectory
        errorMessage="Could not load Task Drops right now."
        items={[]}
        nextCursor={null}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load Task Drops right now.');
    expect(within(alert).getByRole('link', { name: /try again/i })).toHaveAttribute(
      'href',
      '/dashboard/drops'
    );
  });

  it('shows an explanatory empty state', () => {
    render(<TaskDropDirectory items={[]} nextCursor={null} />);

    expect(screen.getByRole('heading', { name: /No Task Drops are live yet/i })).toBeVisible();
    expect(screen.getByText(/new collections of funded work will appear here/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /post a task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
  });

  it('builds cursor links for forward and backward navigation', () => {
    render(
      <TaskDropDirectory
        currentCursor="current/drop"
        cursorStack="previous/drop"
        items={[directoryItem('community', 'Community research')]}
        nextCursor="next/drop"
      />
    );

    const pagination = screen.getByRole('navigation', { name: 'Task Drop pagination' });
    expect(within(pagination).getByRole('link', { name: /previous/i })).toHaveAttribute(
      'href',
      '/dashboard/drops?cursor=previous%2Fdrop'
    );
    expect(within(pagination).getByRole('link', { name: /next/i })).toHaveAttribute(
      'href',
      '/dashboard/drops?cursor=next%2Fdrop&cursorStack=previous%2Fdrop%2Ccurrent%2Fdrop'
    );
  });
});
