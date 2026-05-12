import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { CreateTaskPanel, TaskDetailPanel, TaskFilterRail, TaskTable } from './tasks';

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
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

const taskDetail: TaskDetailResponse = {
  ...task,
  pendingActions: [
    {
      action: 'cancel',
      command: `taskmarket task cancel ${task.id}`,
      role: 'requester',
    },
    {
      action: 'update',
      command: `taskmarket task update ${task.id} [--reward <usdc>] [--extend-expiry <seconds>]`,
      role: 'requester',
    },
    {
      action: 'bid',
      command: `taskmarket task bid ${task.id} --price <n>`,
      role: 'worker',
    },
  ],
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
    expect(screen.getByText(/loading tasks/i)).toBeInTheDocument();

    rerender(<TaskTable tasks={[]} errorMessage="Network failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network failed');
  });

  it('keeps filter links serializable and exposes a clear action', () => {
    render(
      <TaskFilterRail
        deadlineHours="72"
        maxReward="20"
        minReward="2"
        selectedMode="auction"
        selectedStatus="open"
        tags="react"
      />
    );
    expect(screen.getByRole('link', { name: /all modes/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?status=open&tags=react&minReward=2&maxReward=20&deadlineHours=72'
    );
    expect(screen.getByRole('link', { name: /all statuses/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&tags=react&minReward=2&maxReward=20&deadlineHours=72'
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

  it('renders task detail facts, activity, and auction actions', () => {
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
        task={{ ...taskDetail, currentLowestBid: '12000000', maxPrice: '25000000' }}
      />
    );
    expect(screen.getByText(/task facts/i)).toBeInTheDocument();
    expect(screen.getByText(/work requirements/i)).toBeInTheDocument();
    expect(screen.getAllByText(/english auction/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/lowest bid/i)).toBeInTheDocument();
    expect(screen.getAllByText('+12.000 USDC').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/requester actions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/worker actions/i).length).toBeGreaterThan(0);
    expect(screen.getByText(`taskmarket task bid ${task.id} --price <n>`)).toBeInTheDocument();
  });

  it('shows bounty submissions and open management commands', () => {
    render(
      <TaskDetailPanel
        modeData={{ submissions: [] }}
        task={{
          ...taskDetail,
          auctionBidCount: null,
          auctionType: null,
          mode: 'bounty',
          pendingActions: [
            {
              action: 'cancel',
              command: `taskmarket task cancel ${task.id}`,
              role: 'requester',
            },
            {
              action: 'submit',
              command: `taskmarket task submit ${task.id} --file <path>`,
              role: 'worker',
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/submissions will appear here/i)).toBeInTheDocument();
    expect(screen.getAllByText(/requester actions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/worker actions/i).length).toBeGreaterThan(0);
    expect(screen.getByText(`taskmarket task submit ${task.id} --file <path>`)).toBeInTheDocument();
  });

  it('shows pitch deadline, pitch count, and worker selection context', () => {
    render(
      <TaskDetailPanel
        modeData={{
          pitches: [
            {
              estimatedDuration: null,
              id: 'pitch-1',
              pitchText: 'I can produce a concise protocol summary.',
              submittedAt: new Date().toISOString(),
              status: 'pending',
              taskId: task.id,
              workerAddress: '0x2222222222222222222222222222222222222222',
            },
          ],
        }}
        task={{
          ...taskDetail,
          auctionBidCount: null,
          auctionType: null,
          bidDeadline: null,
          mode: 'pitch',
          pendingActions: [
            {
              action: 'pitch',
              command: `taskmarket task pitch ${task.id} --text "..."`,
              role: 'worker',
            },
            {
              action: 'select_worker',
              command: `taskmarket task select-worker ${task.id} --pitch <pitchId> --worker <address>`,
              role: 'requester',
            },
          ],
          pitchCount: 1,
          pitchDeadline: new Date(Date.now() + 7_200_000).toISOString(),
        }}
      />
    );

    expect(screen.getAllByText(/pitch deadline/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 pitch/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/choose a pitch/i)).toBeInTheDocument();
    expect(screen.getByText(/i can produce a concise protocol summary/i)).toBeInTheDocument();
  });

  it('shows pending approval submissions and requester review action', () => {
    render(
      <TaskDetailPanel
        modeData={{
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
        task={{
          ...taskDetail,
          auctionBidCount: null,
          auctionType: null,
          mode: 'bounty',
          pendingActions: [
            {
              action: 'accept',
              command: `taskmarket task accept ${task.id} --worker 0x3333333333333333333333333333333333333333`,
              role: 'requester',
            },
          ],
          status: 'pending_approval',
          submissionCount: 1,
        }}
      />
    );

    expect(screen.getByText(/awaiting requester review/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 submission/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/review the latest submission/i)).toBeInTheDocument();
    expect(screen.getByText(/taskmarket task accept/i)).toBeInTheDocument();
  });

  it('keeps payout and timing visible when activity and actions are empty', () => {
    render(
      <TaskDetailPanel
        modeData={{ bids: [] }}
        task={{
          ...taskDetail,
          pendingActions: [],
        }}
      />
    );

    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no pending commands/i)).toBeInTheDocument();
    expect(screen.getByText(/payout/i)).toBeInTheDocument();
    expect(screen.getByText(/timing/i)).toBeInTheDocument();
    expect(screen.getAllByText('+25.000 USDC').length).toBeGreaterThan(0);
  });
});
