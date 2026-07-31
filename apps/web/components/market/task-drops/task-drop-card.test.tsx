import type { TaskDropDirectoryItem } from '@taskmarket/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskDropCard } from './task-drop-card';

const item: TaskDropDirectoryItem = {
  availableTaskCount: 2,
  drop: {
    announcedAt: '2026-07-02T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    description: 'A focused collection of research and launch work.',
    id: 'launch/drop one',
    isOfficial: true,
    name: 'Launch week',
    officialWalletAddress: '0x1111111111111111111111111111111111111111',
    ownerAddress: '0x1111111111111111111111111111111111111111',
  },
  latestTaskAt: '2026-07-03T00:00:00.000Z',
  nextExpiryTime: '2099-07-09T00:00:00.000Z',
  resolvedTaskCount: 1,
  taskCount: 3,
  totalReward: '6000000',
};

describe('TaskDropCard', () => {
  it('makes the whole summary one descriptive dashboard link', () => {
    render(<TaskDropCard item={item} />);

    const card = screen.getByRole('article');
    const links = within(card).getAllByRole('link');

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('View Launch week Task Drop');
    expect(links[0]).toHaveAttribute('href', '/dashboard/drops/launch%2Fdrop%20one');
    expect(within(card).getByText('Official drop')).toBeVisible();
    expect(within(card).getByText('2 available')).toBeVisible();
    expect(within(card).getByText('3')).toBeVisible();
    expect(within(card).getByText('Total')).toBeVisible();
    expect(within(card).getByText('6 USDC')).toBeVisible();
    expect(within(card).getByText('0x1111...1111')).toBeVisible();
    expect(within(card).getByText(/Updated/)).toBeVisible();
    expect(within(card).getByText('Available')).toBeVisible();
  });

  it('does not label unresolved work as resolved when no future deadline exists', () => {
    render(
      <TaskDropCard
        item={{
          ...item,
          availableTaskCount: 0,
          nextExpiryTime: null,
          resolvedTaskCount: 0,
          taskCount: 1,
        }}
      />
    );

    const card = screen.getByRole('article');
    expect(within(card).queryAllByText('Resolved')).toHaveLength(0);
    expect(within(card).getAllByText('In progress')).not.toHaveLength(0);
    expect(within(card).getByText('1 task')).toBeVisible();
  });

  it('uses the resolved state when every task is complete', () => {
    render(
      <TaskDropCard
        item={{
          ...item,
          availableTaskCount: 0,
          nextExpiryTime: null,
          resolvedTaskCount: 3,
        }}
      />
    );

    const card = screen.getByRole('article');
    expect(within(card).getAllByText('Resolved')).not.toHaveLength(0);
    expect(within(card).getByText('3 resolved')).toBeVisible();
  });
});
