import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidResponse, TaskDetailResponse } from '@taskmarket/shared';

import { LiveStatusBanner } from './live-status-banner';

const { bidsState, mockAccount, reducedMotionState } = vi.hoisted(() => ({
  bidsState: { value: [] as unknown[] },
  mockAccount: { address: undefined as string | undefined },
  reducedMotionState: { value: true },
}));

function stubQuery(_input: unknown, options?: { initialData?: unknown }) {
  return { data: options?.initialData };
}

vi.mock('@/lib/api/client', () => ({
  trpc: {
    bids: {
      listByTask: {
        // Mirror react-query: an enabled query returns the controllable array; a
        // disabled query still returns its initialData (the SSR seed).
        useQuery: (_input: unknown, options?: { enabled?: boolean; initialData?: unknown }) => ({
          data: options?.enabled ? bidsState.value : options?.initialData,
        }),
      },
    },
    pitches: { listByTask: { useQuery: stubQuery } },
    proofs: { listByTask: { useQuery: stubQuery } },
    submissions: { listByTask: { useQuery: stubQuery } },
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => (
    <div data-animate-presence="true">{children as never}</div>
  ),
  motion: {
    span: ({
      animate: _animate,
      initial: _initial,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => <span data-motion-span="true" {...props} />,
  },
  useReducedMotion: () => reducedMotionState.value,
}));

const REQUESTER = '0x1111111111111111111111111111111111111111';

const task: TaskDetailResponse = {
  auctionBidCount: null,
  auctionType: 'english',
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: new Date().toISOString(),
  currentLowestBid: null,
  description: 'Auction task',
  escrowTxHash: '0xhash',
  expiryTime: new Date(Date.now() + 86_400_000).toISOString(),
  id: 'task-1',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'auction',
  pendingActions: [],
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester: REQUESTER,
  requesterPubkey: REQUESTER,
  reward: '25000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 0,
  // The API reports the deliverable window here: false for an open auction
  // still taking bids (only true once a worker is locked in).
  submissionWindowOpen: false,
  tags: ['research'],
  taskVisibilityMode: 'public',
};

function bid(id: string, worker: string): BidResponse {
  return {
    createdAt: new Date().toISOString(),
    id,
    price: '12000000',
    taskId: task.id,
    workerAddress: worker,
  };
}

function renderBanner(overrides?: {
  task?: Partial<TaskDetailResponse>;
  initialBids?: BidResponse[];
  marketStats?: { activeWorkers7d: number; openTasks: number; registeredWorkers: number } | null;
}) {
  return render(
    <LiveStatusBanner
      marketStats={overrides?.marketStats ?? null}
      modeData={{ bids: overrides?.initialBids ?? [] }}
      task={{ ...task, ...overrides?.task }}
    />
  );
}

beforeEach(() => {
  bidsState.value = [];
  mockAccount.address = undefined;
  reducedMotionState.value = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LiveStatusBanner', () => {
  it('renders the quiet-market copy for an open window-open task with no stats', () => {
    renderBanner({ initialBids: [], marketStats: null });

    expect(screen.getByText('Live and broadcasting to the network')).toBeInTheDocument();
    expect(screen.getByText(/a quiet market right now/i)).toBeInTheDocument();
    expect(screen.getByText('Deadline')).toBeInTheDocument();
  });

  it('renders the active-market copy when active workers meet the threshold', () => {
    renderBanner({
      initialBids: [],
      marketStats: { activeWorkers7d: 3, openTasks: 4, registeredWorkers: 20 },
    });

    expect(screen.getByText(/3 workers were active this week/i)).toBeInTheDocument();
    expect(screen.getByText(/first bids usually arrive soon/i)).toBeInTheDocument();
  });

  it('renders the arriving state with the count when activity seeds', () => {
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderBanner({
      initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')],
    });

    expect(screen.getByText('Work is arriving')).toBeInTheDocument();
    expect(screen.getByText(/1 bid so far - still open and taking more/i)).toBeInTheDocument();
  });

  it('returns null for a terminal task', () => {
    const { container } = renderBanner({ initialBids: [], task: { status: 'completed' } });

    expect(container.firstChild).toBeNull();
  });

  it('returns null for an open auction whose bid deadline has passed', () => {
    const { container } = renderBanner({
      initialBids: [],
      task: { bidDeadline: new Date(Date.now() - 60_000).toISOString() },
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders for an open claim task that is still claimable', () => {
    renderBanner({
      initialBids: [],
      task: { auctionType: null, mode: 'claim', submissionWindowOpen: false },
    });

    expect(screen.getByText('Live and broadcasting to the network')).toBeInTheDocument();
    expect(screen.getByText(/a quiet market right now/i)).toBeInTheDocument();
  });

  it('shows owner copy for the requester and visitor copy for others', () => {
    mockAccount.address = REQUESTER;
    const { rerender } = renderBanner({ initialBids: [], marketStats: null });

    expect(screen.getByText(/you may be first in line/i)).toBeInTheDocument();

    mockAccount.address = '0x9999999999999999999999999999999999999999';
    rerender(<LiveStatusBanner marketStats={null} modeData={{ bids: [] }} task={{ ...task }} />);

    expect(screen.getByText(/you may be among the first tasks workers see/i)).toBeInTheDocument();
  });
});
