import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';

import { TaskListBoard } from './task-thumbnail';

// TaskTable pulls in the full task detail/actions tree; the board test only cares
// about the view-toggle island, so stub TaskTable to echo the view it receives.
vi.mock('./tasks', () => ({
  TaskTable: ({ view }: { view: string }) => <div data-testid="task-table">view:{view}</div>,
}));

const task: TaskResponse = {
  id: '0xabc123',
  requester: '0x1111111111111111111111111111111111111111',
  requesterPubkey: '0x1111111111111111111111111111111111111111',
  description: 'Summarize protocol feedback',
  reward: '25000000',
  escrowTxHash: '0xhash',
  createdAt: new Date().toISOString(),
  expiryTime: new Date(Date.now() + 3_600_000).toISOString(),
  status: 'open',
  tags: ['research'],
  mode: 'bounty',
  taskVisibility: 'public',
  submissionVisibility: 'public',
  stakeRequired: false,
  stakeBps: 0,
  pitchDeadline: null,
  bidDeadline: null,
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  claimedBy: null,
  claimedAt: null,
  platformFeeBps: 250,
  submissionCount: 0,
  pitchCount: 0,
  auctionType: null,
  auctionBidCount: 0,
  submissionWindowOpen: true,
  phase: 'active',
};

describe('TaskListBoard', () => {
  it('renders the compact table as the deterministic default view', () => {
    render(<TaskListBoard currentFilters={{}} tasks={[task]} view="table" />);

    expect(screen.getByTestId('task-table')).toHaveTextContent('view:table');
    expect(screen.getByRole('link', { name: /gallery view/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /table view/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('links between URL-backed views while preserving filters and sort but resetting pagination', () => {
    render(
      <TaskListBoard
        basePath="/tasks"
        currentFilters={{
          cursor: 'next-page',
          cursorStack: 'first-page',
          mode: 'auction',
          sort: 'reward_desc',
          status: 'open',
          view: 'gallery',
        }}
        tasks={[task]}
        view="gallery"
      />
    );

    // Only 'table' round-trips as an explicit query param when it comes from an
    // actual navigation (this toggle click), not merely carried through as the
    // deterministic non-mobile default -- otherwise the toggle could not opt a
    // mobile visitor back out of the gallery default (see task-filters.ts).
    expect(screen.getByRole('link', { name: /table view/i })).toHaveAttribute(
      'href',
      '/tasks?mode=auction&status=open&sort=reward_desc&view=table'
    );
    expect(screen.getByRole('link', { name: /gallery view/i })).toHaveAttribute(
      'href',
      '/tasks?mode=auction&status=open&sort=reward_desc&view=gallery'
    );
    expect(screen.getByTestId('task-table')).toHaveTextContent('view:gallery');
  });

  it('hides the toggle when there are no tasks to lay out', () => {
    render(<TaskListBoard currentFilters={{}} tasks={[]} view="table" />);

    expect(screen.queryByRole('link', { name: /gallery view/i })).not.toBeInTheDocument();
  });
});
