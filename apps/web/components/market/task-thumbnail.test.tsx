import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';

import { TaskListBoard, TaskViewToggle } from './task-thumbnail';

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
    render(<TaskListBoard currentFilters={{}} tasks={[task]} />);

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

    expect(screen.getByRole('link', { name: /table view/i })).toHaveAttribute(
      'href',
      '/tasks?mode=auction&status=open&sort=reward_desc'
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

  it('uses list terminology and full-width tap targets in the mobile presentation', () => {
    render(<TaskViewToggle currentFilters={{ mode: 'auction' }} presentation="mobile" />);

    const toggle = screen.getByRole('group', { name: /task view/i });
    const listLink = screen.getByRole('link', { name: /list view/i });

    expect(toggle).toHaveClass('grid-cols-2');
    expect(listLink).toHaveTextContent('List');
    expect(listLink).toHaveClass('min-h-11');
    expect(listLink).toHaveAttribute('href', '/dashboard/tasks?mode=auction');
  });
});
