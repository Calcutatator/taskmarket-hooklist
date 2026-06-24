import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidResponse, TaskDetailResponse } from '@taskmarket/shared';

import { LiveActivityPanel } from './live-activity';

const { bidsState, mockAccount, reducedMotionState, toastSpy } = vi.hoisted(() => ({
  bidsState: { value: [] as unknown[] },
  mockAccount: { address: undefined as string | undefined },
  reducedMotionState: { value: true },
  toastSpy: vi.fn(),
}));

function stubQuery(_input: unknown, options?: { initialData?: unknown }) {
  return { data: options?.initialData };
}

vi.mock('@/lib/api/client', () => ({
  trpc: {
    bids: {
      listByTask: {
        // Mirror react-query: an enabled query polls the controllable growing
        // array; a disabled query still returns its initialData (the SSR seed),
        // exactly as a real disabled query with initialData would.
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

vi.mock('sonner', () => ({
  toast: Object.assign((message: string) => toastSpy(message), { success: vi.fn() }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => (
    <div data-animate-presence="true">{children as never}</div>
  ),
  motion: {
    div: ({
      animate: _animate,
      initial: _initial,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => <div data-motion-div="true" {...props} />,
  },
  useReducedMotion: () => reducedMotionState.value,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
  rating: null,
  requester: REQUESTER,
  requesterPubkey: REQUESTER,
  reward: '25000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 0,
  submissionWindowOpen: true,
  tags: ['research'],
  worker: null,
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

function renderPanel(overrides?: {
  task?: Partial<TaskDetailResponse>;
  initialBids?: BidResponse[];
  marketStats?: { activeWorkers7d: number; openTasks: number; registeredWorkers: number } | null;
}) {
  return render(
    <LiveActivityPanel
      initialModeData={{ bids: overrides?.initialBids ?? [] }}
      marketStats={overrides?.marketStats ?? null}
      profileBasePath="/dashboard/agents"
      task={{ ...task, ...overrides?.task }}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  bidsState.value = [];
  mockAccount.address = undefined;
  reducedMotionState.value = true;
  toastSpy.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('LiveActivityPanel', () => {
  it('shows the Live indicator and feed for the requester on a live task', () => {
    mockAccount.address = REQUESTER;
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderPanel({ initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')] });

    expect(screen.getByText(/^Live$/)).toBeInTheDocument();
    expect(screen.getAllByText('12.000 USDC').length).toBeGreaterThan(0);
  });

  it('shows the live feed and Live indicator for a non-requester on a live task', () => {
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    // A non-requester now polls too (pollEnabled = !terminal), so the feed
    // reflects the polled value, not just the seed.
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderPanel({ initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')] });

    expect(screen.getByText(/^Live$/)).toBeInTheDocument();
    expect(screen.getAllByText('12.000 USDC').length).toBeGreaterThan(0);
  });

  it('does not toast a non-requester when new activity arrives', () => {
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    bidsState.value = [];

    const { rerender } = renderPanel({ initialBids: [] });

    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];
    rerender(
      <LiveActivityPanel
        initialModeData={{ bids: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        task={task}
      />
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    // Toasts are a requester-only affordance; the public feed updates silently.
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('does not toast for the initial seed items', () => {
    mockAccount.address = REQUESTER;
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderPanel({ initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')] });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('emits a single batched toast for multiple new arrivals and dedupes on re-render', () => {
    mockAccount.address = REQUESTER;
    bidsState.value = [];

    const { rerender } = renderPanel({ initialBids: [] });

    // Three new bids arrive before the debounce fires -> one summary toast.
    bidsState.value = [
      bid('bid-1', '0x2222222222222222222222222222222222222222'),
      bid('bid-2', '0x3333333333333333333333333333333333333333'),
      bid('bid-3', '0x4444444444444444444444444444444444444444'),
    ];
    rerender(
      <LiveActivityPanel
        initialModeData={{ bids: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        task={task}
      />
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith('3 new bids');

    // Re-render with the same ids must not toast again.
    rerender(
      <LiveActivityPanel
        initialModeData={{ bids: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        task={task}
      />
    );
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('writes the batched message to the aria-live region', () => {
    mockAccount.address = REQUESTER;
    bidsState.value = [];

    const { rerender } = renderPanel({ initialBids: [] });

    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];
    rerender(
      <LiveActivityPanel
        initialModeData={{ bids: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        task={task}
      />
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toMatch(/new bid from/i);
  });

  it('shows the anticipation state for a requester with an active market', () => {
    mockAccount.address = REQUESTER;

    renderPanel({
      initialBids: [],
      marketStats: { activeWorkers7d: 8, openTasks: 4, registeredWorkers: 20 },
    });

    expect(screen.getByText(/reaching active workers/i)).toBeInTheDocument();
    expect(screen.getByText(/8 workers were active this week/i)).toBeInTheDocument();
    // Tertiary per-mode line is retained.
    expect(screen.getByText(/bids will appear here/i)).toBeInTheDocument();
  });

  it('shows the quiet-market anticipation copy below the active threshold', () => {
    mockAccount.address = REQUESTER;

    renderPanel({
      initialBids: [],
      marketStats: { activeWorkers7d: 1, openTasks: 0, registeredWorkers: 2 },
    });

    expect(screen.getByText(/a quiet market right now/i)).toBeInTheDocument();
  });

  it('keeps the plain empty state for non-requesters', () => {
    mockAccount.address = '0x9999999999999999999999999999999999999999';

    renderPanel({
      initialBids: [],
      marketStats: { activeWorkers7d: 8, openTasks: 4, registeredWorkers: 20 },
    });

    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/reaching active workers/i)).not.toBeInTheDocument();
  });

  it('renders the plain empty state and disables polling for a terminal task', () => {
    mockAccount.address = REQUESTER;
    // Even though the requester is connected, a completed task must not poll or
    // show Live/anticipation. The mock returns [] when enabled is false.
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderPanel({ initialBids: [], task: { status: 'completed' } });

    expect(screen.queryByText(/^Live$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reaching active workers/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('renders without motion wrappers under the reduced-motion path', () => {
    // The component treats jsdom/test/reduced-motion as "no motion", so the feed
    // renders the seed rows directly with no AnimatePresence/motion wrappers.
    mockAccount.address = REQUESTER;
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    const { container } = renderPanel({
      initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')],
    });

    expect(container.querySelector('[data-motion-div="true"]')).toBeNull();
  });
});
