import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';

import { TaskListBoard } from './task-thumbnail';

const STORAGE_KEY = 'taskmarket.task-list-view';

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
  taskVisibilityMode: 'public',
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
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('TaskListBoard', () => {
  it('defaults to the gallery view', async () => {
    render(<TaskListBoard tasks={[task]} />);

    // The gallery button is pressed by default and the table receives the gallery view.
    expect(await screen.findByTestId('task-table')).toHaveTextContent('view:gallery');
    expect(screen.getByRole('button', { name: /gallery view/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /table view/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('persists the chosen view to localStorage when toggled', async () => {
    const user = userEvent.setup();
    render(<TaskListBoard tasks={[task]} />);

    await user.click(screen.getByRole('button', { name: /table view/i }));

    expect(screen.getByTestId('task-table')).toHaveTextContent('view:table');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('table');

    await user.click(screen.getByRole('button', { name: /gallery view/i }));

    expect(screen.getByTestId('task-table')).toHaveTextContent('view:gallery');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('gallery');
  });

  it('restores a previously stored table view after mount', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'table');

    render(<TaskListBoard tasks={[task]} />);

    expect(await screen.findByText('view:table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /table view/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('ignores an invalid stored value and stays on the gallery default', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'mosaic');

    render(<TaskListBoard tasks={[task]} />);

    expect(await screen.findByText('view:gallery')).toBeInTheDocument();
  });

  it('hides the toggle when there are no tasks to lay out', () => {
    render(<TaskListBoard tasks={[]} />);

    expect(screen.queryByRole('button', { name: /gallery view/i })).not.toBeInTheDocument();
  });
});
