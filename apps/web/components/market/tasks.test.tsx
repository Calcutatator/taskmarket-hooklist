import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';
import { CreateTaskPanel, TaskDetailPanel, TaskFilterRail, TaskTable } from './tasks';

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
  worker: null,
  rating: null,
  mode: 'auction',
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
  auctionType: 'english',
  auctionBidCount: 2,
};

describe('Task marketplace components', () => {
  it('renders populated, empty, loading, and error task table states', () => {
    const { rerender } = render(<TaskTable tasks={[task]} />);
    expect(screen.getByRole('link', { name: /summarize protocol feedback/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/0xabc123'
    );
    expect(screen.getByText('+25.000 USDC')).toBeInTheDocument();

    rerender(<TaskTable tasks={[]} />);
    expect(screen.getByText(/no open tasks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no open tasks yet/i).closest('[data-slot="card"]')).toHaveClass(
      'w-full',
      'border-dashed'
    );
    expect(screen.getByRole('link', { name: /post task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );

    rerender(<TaskTable tasks={[]} hasActiveFilters />);
    expect(screen.getByText(/no tasks match these filters/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /clear filters/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );

    rerender(<TaskTable tasks={[]} isLoading />);
    expect(screen.getByText(/loading marketplace rows/i)).toBeInTheDocument();

    rerender(<TaskTable tasks={[]} errorMessage="Network failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network failed');
  });

  it('keeps filter links serializable and exposes a clear action', () => {
    render(
      <TaskFilterRail
        maxReward="20"
        minReward="2"
        selectedMode="auction"
        selectedStatus="open"
        tags="react"
      />
    );
    expect(screen.getByRole('link', { name: /all modes/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?status=open'
    );
    expect(screen.getByLabelText(/tags/i)).toHaveValue('react');
    expect(screen.getByLabelText(/min reward/i)).toHaveValue(2);
    expect(screen.getByLabelText(/max reward/i)).toHaveValue(20);
    expect(screen.getByRole('link', { name: /clear filters/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
  });

  it('blocks create task submission until wallet actions are connected', () => {
    render(<CreateTaskPanel walletConnected={false} />);
    expect(screen.getByRole('button', { name: /connect wallet to create/i })).toBeDisabled();
  });

  it('renders task detail mode and pending status without layout-specific data', () => {
    render(
      <TaskDetailPanel
        modeData={{
          bids: [
            {
              createdAt: new Date().toISOString(),
              id: 'bid-1',
              price: '12000000',
              taskId: task.id,
              workerAddress: '0x2222222222222222222222222222222222222222',
            },
          ],
          submissions: [
            {
              artifacts: [],
              fileUrl: 'ipfs://deliverable',
              id: 'sub-1',
              signature: '0xsig',
              submittedAt: new Date().toISOString(),
              taskId: task.id,
              workerAddress: '0x3333333333333333333333333333333333333333',
            },
          ],
        }}
        task={{ ...task, status: 'pending_approval' }}
      />
    );
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByText(/english auction/i)).toBeInTheDocument();
    expect(screen.getByText(/auction bids/i)).toBeInTheDocument();
    expect(screen.getByText('+12.000 USDC')).toBeInTheDocument();
    expect(screen.getAllByText(/submissions/i).length).toBeGreaterThan(0);
  });
});
