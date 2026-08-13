import { fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BidResponse,
  ProofResponse,
  SubmissionResponse,
  TaskDetailResponse,
} from '@taskmarket/shared';

import { LiveActivityPanel } from './live-activity';

const {
  authenticatedSubmissionsQuerySpy,
  bidsState,
  mockAccount,
  readAuthReadyState,
  readAuthSignatureSpy,
  reducedMotionState,
  submissionsState,
  toastSpy,
} = vi.hoisted(() => ({
  authenticatedSubmissionsQuerySpy: vi.fn(),
  bidsState: { value: [] as unknown[] },
  mockAccount: { address: undefined as string | undefined, isConnected: false },
  readAuthReadyState: { value: false },
  readAuthSignatureSpy: vi.fn(),
  reducedMotionState: { value: true },
  submissionsState: { value: [] as SubmissionResponse[] },
  toastSpy: vi.fn(),
}));

function stubQuery(_input: unknown, options?: { initialData?: unknown }) {
  return { data: options?.initialData };
}

vi.mock('@/lib/api/client', () => ({
  READ_AUTH_CONTEXT_KEY: 'taskmarketReadAuth',
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
    submissions: {
      listByTask: {
        useQuery: (_input: unknown, options?: { enabled?: boolean; initialData?: unknown }) => ({
          data: options?.enabled ? submissionsState.value : options?.initialData,
        }),
      },
    },
    useUtils: (() => {
      const utils = {
        client: {
          submissions: {
            listByTask: {
              query: authenticatedSubmissionsQuerySpy,
            },
          },
        },
      };
      return () => utils;
    })(),
  },
}));

vi.mock('@/lib/use-read-auth-signature', () => ({
  useReadAuthSignature: (address: string | undefined) => {
    readAuthSignatureSpy(address);
    return readAuthReadyState.value;
  },
  // Every paid action's `useInFlightWrite` asks for one, so the whole module must be stubbed.
  useReadAuthSignatureState: () => ({
    error: null,
    ready: false,
    requestSignature: () => {},
    status: 'idle',
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign((message: string) => toastSpy(message), { success: vi.fn() }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
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
  useReducedMotionConfig: () => reducedMotionState.value,
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
  phase: 'active',
  tags: ['research'],
  taskVisibility: 'public',
  submissionVisibility: 'public',
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

function submission(id: string, worker: string): SubmissionResponse {
  return {
    artifacts: [],
    fileUrl: `ipfs://${id}`,
    id,
    signature: '0xsignature',
    submittedAt: new Date().toISOString(),
    taskId: task.id,
    workerAddress: worker,
  };
}

function proof(id: string, worker: string): ProofResponse {
  return {
    id,
    metricValue: '0.92',
    proofData: 'ipfs://proof-data',
    proofType: 'eval',
    status: 'pending',
    submissionId: null,
    submittedAt: new Date().toISOString(),
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
  authenticatedSubmissionsQuerySpy.mockReset();
  authenticatedSubmissionsQuerySpy.mockImplementation(async () => submissionsState.value);
  bidsState.value = [];
  mockAccount.address = undefined;
  mockAccount.isConnected = false;
  readAuthReadyState.value = false;
  readAuthSignatureSpy.mockClear();
  reducedMotionState.value = true;
  submissionsState.value = [];
  toastSpy.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('LiveActivityPanel', () => {
  it.each([
    ['disconnects', undefined],
    ['switches accounts', '0x9999999999999999999999999999999999999999'],
  ])(
    'renders gated terminal submissions after auth and clears them when the wallet %s',
    async (_, nextAddress) => {
      mockAccount.address = REQUESTER;
      submissionsState.value = [
        {
          artifacts: [],
          fileUrl: 'ipfs://deliverable',
          id: 'submission-1',
          signature: '0xsignature',
          submittedAt: new Date().toISOString(),
          taskId: task.id,
          workerAddress: '0x2222222222222222222222222222222222222222',
        },
      ];
      const gatedTask = {
        ...task,
        auctionType: null,
        mode: 'bounty' as const,
        status: 'completed' as const,
        submissionCount: 1,
        submissionVisibility: 'never' as const,
      };
      const panel = () => (
        <LiveActivityPanel
          initialModeData={{ submissions: [] }}
          marketStats={null}
          profileBasePath="/dashboard/agents"
          task={gatedTask}
        />
      );

      const { rerender } = render(panel());

      expect(readAuthSignatureSpy).toHaveBeenLastCalledWith(REQUESTER);
      expect(screen.queryByLabelText('Submission from 0x2222...2222')).not.toBeInTheDocument();

      readAuthReadyState.value = true;
      await act(async () => {
        rerender(panel());
        await Promise.resolve();
      });

      expect(screen.getByLabelText('Submission from 0x2222...2222')).toBeInTheDocument();
      expect(authenticatedSubmissionsQuerySpy).toHaveBeenCalledWith(
        {
          includePreviewUrls: 'media',
          taskId: task.id,
        },
        {
          context: { taskmarketReadAuth: true },
          signal: expect.any(AbortSignal),
        }
      );

      mockAccount.address = nextAddress;
      readAuthReadyState.value = false;
      rerender(panel());

      expect(screen.queryByLabelText('Submission from 0x2222...2222')).not.toBeInTheDocument();
    }
  );

  it('ignores an authenticated response that resolves after an account switch', async () => {
    let resolveSubmissions: ((submissions: SubmissionResponse[]) => void) | undefined;
    authenticatedSubmissionsQuerySpy.mockImplementationOnce(
      () =>
        new Promise<SubmissionResponse[]>((resolve) => {
          resolveSubmissions = resolve;
        })
    );
    mockAccount.address = REQUESTER;
    readAuthReadyState.value = true;
    const gatedTask = {
      ...task,
      auctionType: null,
      mode: 'bounty' as const,
      status: 'completed' as const,
      submissionCount: 1,
      submissionVisibility: 'never' as const,
    };
    const panel = () => (
      <LiveActivityPanel
        initialModeData={{ submissions: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        task={gatedTask}
      />
    );
    const { rerender } = render(panel());

    expect(authenticatedSubmissionsQuerySpy).toHaveBeenCalledTimes(1);
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    readAuthReadyState.value = false;
    rerender(panel());

    await act(async () => {
      resolveSubmissions?.([
        {
          artifacts: [],
          fileUrl: 'ipfs://deliverable',
          id: 'submission-1',
          signature: '0xsignature',
          submittedAt: new Date().toISOString(),
          taskId: task.id,
          workerAddress: '0x2222222222222222222222222222222222222222',
        },
      ]);
    });

    expect(screen.queryByLabelText('Submission from 0x2222...2222')).not.toBeInTheDocument();
  });

  it('announces gated submissions arriving after the authenticated baseline', async () => {
    const firstSubmission = submission(
      'submission-1',
      '0x2222222222222222222222222222222222222222'
    );
    const secondSubmission = submission(
      'submission-2',
      '0x3333333333333333333333333333333333333333'
    );
    mockAccount.address = REQUESTER;
    readAuthReadyState.value = true;
    submissionsState.value = [firstSubmission];

    render(
      <LiveActivityPanel
        initialModeData={{ submissions: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        task={{
          ...task,
          auctionType: null,
          mode: 'bounty',
          submissionCount: 1,
          submissionVisibility: 'never',
        }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Submission from 0x2222...2222')).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();

    submissionsState.value = [firstSubmission, secondSubmission];
    await act(async () => {
      vi.advanceTimersByTime(9_000);
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Submission from 0x3333...3333')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(toastSpy).toHaveBeenCalledWith('New submission from 0x3333...3333');
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'New submission from 0x3333...3333'
    );
  });

  it('keeps repeat submissions silent and announces only a new submitter in review mode', () => {
    const firstSubmission = submission(
      'submission-1',
      '0x2222222222222222222222222222222222222222'
    );
    const revision = {
      ...submission('submission-2', '0x2222222222222222222222222222222222222222'),
      submittedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const newSubmitter = submission('submission-3', '0x3333333333333333333333333333333333333333');
    const reviewTask = {
      ...task,
      auctionType: null,
      mode: 'bounty' as const,
      submissionCount: 1,
    };
    const panel = () => (
      <LiveActivityPanel
        initialModeData={{ submissions: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        submissionReviewEligible
        task={reviewTask}
      />
    );

    mockAccount.address = REQUESTER;
    submissionsState.value = [firstSubmission];
    const { rerender } = render(panel());

    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(1);
    expect(toastSpy).not.toHaveBeenCalled();

    submissionsState.value = [firstSubmission, revision];
    rerender(panel());
    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /^View all 2 submissions from/ })
    ).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();

    submissionsState.value = [firstSubmission, revision, newSubmitter];
    rerender(panel());
    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith('New submitter from 0x3333...3333');
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'New submitter from 0x3333...3333'
    );
  });

  it('shows the Live indicator and feed for the requester on a live task', () => {
    mockAccount.address = REQUESTER;
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderPanel({ initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')] });

    expect(screen.getByText(/^Live$/)).toBeInTheDocument();
    expect(screen.getAllByText('12 USDC').length).toBeGreaterThan(0);
  });

  it('shows the live feed and Live indicator for a non-requester on a live task', () => {
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    // A non-requester now polls too (pollEnabled = !terminal), so the feed
    // reflects the polled value, not just the seed.
    bidsState.value = [bid('bid-1', '0x2222222222222222222222222222222222222222')];

    renderPanel({ initialBids: [bid('bid-1', '0x2222222222222222222222222222222222222222')] });

    expect(screen.getByText(/^Live$/)).toBeInTheDocument();
    expect(screen.getAllByText('12 USDC').length).toBeGreaterThan(0);
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

  it('does not flag the window closed for an open auction still taking bids', () => {
    renderPanel({ initialBids: [] });

    expect(screen.queryByText('Submission window closed')).not.toBeInTheDocument();
  });

  it('flags the window closed for an open pitch task past its pitch deadline', () => {
    renderPanel({
      initialBids: [],
      task: {
        auctionType: null,
        mode: 'pitch',
        pitchDeadline: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(screen.getByText('Submission window closed')).toBeInTheDocument();
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

describe('LiveActivityPanel benchmark secondary submissions surface', () => {
  const WORKER_A = '0x2222222222222222222222222222222222222222';
  const WORKER_B = '0x3333333333333333333333333333333333333333';

  const benchmarkAccept = {
    action: 'accept' as const,
    command: `taskmarket task accept ${task.id} --worker ${WORKER_A}`,
    role: 'requester' as const,
  };
  const benchmarkReject = {
    action: 'reject_submission' as const,
    command: `taskmarket task reject-submission ${task.id} --worker <address>`,
    role: 'requester' as const,
  };

  function renderBenchmarkPanel(overrides?: {
    submissions?: SubmissionResponse[];
    proofs?: ProofResponse[];
    submissionCount?: number;
    withReviewActions?: boolean;
    secondarySubmissionReview?: boolean;
  }) {
    const benchmarkTask = {
      ...task,
      auctionType: null,
      mode: 'benchmark' as const,
      submissionCount: overrides?.submissionCount ?? overrides?.submissions?.length ?? 0,
    };
    return render(
      <LiveActivityPanel
        initialModeData={{ proofs: overrides?.proofs ?? [], submissions: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        reviewActions={
          overrides?.withReviewActions === false
            ? undefined
            : { acceptAction: benchmarkAccept, rejectAction: benchmarkReject }
        }
        secondarySubmissionReview={overrides?.secondarySubmissionReview ?? true}
        task={benchmarkTask}
      />
    );
  }

  // TaskDetailPanel computes `secondarySubmissionReview` from
  // `task.submissionCount > 0` and only ever passes `true` down to
  // LiveActivityPanel when that holds (see tasks.tsx's `benchmarkSubmissionReview`
  // and the corresponding tasks.test.tsx coverage). At this component level, a
  // benchmark task with zero submissions is exactly a task the parent never flags
  // as eligible, so it renders with the flag left at its default `false`.
  it('renders no Additional submissions disclosure when submissionCount is 0', () => {
    submissionsState.value = [];
    renderBenchmarkPanel({ secondarySubmissionReview: false, submissionCount: 0 });

    expect(screen.queryByTestId('benchmark-submission-review')).not.toBeInTheDocument();
    expect(screen.queryByText(/additional submissions/i)).not.toBeInTheDocument();
  });

  it('renders the disclosure collapsed by default with the correct count', () => {
    mockAccount.address = REQUESTER;
    submissionsState.value = [submission('sub-1', WORKER_A), submission('sub-2', WORKER_B)];

    renderBenchmarkPanel({ submissions: submissionsState.value });

    const disclosure = screen.getByTestId('benchmark-submission-review');
    expect(disclosure.tagName).toBe('DETAILS');
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByText('Additional submissions (2)')).toBeInTheDocument();
  });

  it('groups the secondary surface by worker using the primary queue rules', () => {
    mockAccount.address = REQUESTER;
    submissionsState.value = [
      submission('sub-1', WORKER_A),
      submission('sub-2', WORKER_A),
      submission('sub-3', WORKER_B),
    ];

    renderBenchmarkPanel({ submissions: submissionsState.value });

    act(() => {
      fireEvent.click(screen.getByText('Additional submissions (3)'));
    });

    expect(
      screen.getByTestId(`benchmark-submitter-group-${WORKER_A.toLowerCase()}`)
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`benchmark-submitter-group-${WORKER_B.toLowerCase()}`)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^View all 2 submissions from/ })
    ).toBeInTheDocument();
  });

  it('wires accept/reject on the secondary surface with the primary queue command shape', () => {
    mockAccount.address = REQUESTER;
    mockAccount.isConnected = true;
    submissionsState.value = [submission('sub-1', WORKER_A)];

    renderBenchmarkPanel({ submissions: submissionsState.value });

    act(() => {
      fireEvent.click(screen.getByText('Additional submissions (1)'));
    });

    expect(screen.getAllByText('Release payout').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Releases payout to this worker using their latest active submission.')
    ).toBeInTheDocument();

    const rejectButton = screen.getByRole('button', {
      name: 'Reject submitter and all 1 submission',
    });
    expect(rejectButton).toBeInTheDocument();

    act(() => {
      fireEvent.click(rejectButton);
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reject this submitter?')).toBeInTheDocument();
    expect(within(dialog).getByText(/0\.001 usdc/i)).toBeInTheDocument();
    expect(within(dialog).getByText(WORKER_A, { exact: false })).toBeInTheDocument();
  });

  it('keeps the secondary surface state isolated from the primary proof feed, and vice versa', () => {
    mockAccount.address = REQUESTER;
    submissionsState.value = [submission('sub-1', WORKER_A), submission('sub-2', WORKER_B)];
    const proofs = [proof('proof-1', '0x4444444444444444444444444444444444444444')];

    renderBenchmarkPanel({ proofs, submissions: submissionsState.value });

    // Primary proof feed is present and unaffected before any secondary interaction.
    expect(screen.getByText('eval')).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();

    // Opening, and paginating within, the secondary surface must not touch the
    // primary feed's rendered state, toasts, or live region.
    act(() => {
      fireEvent.click(screen.getByText('Additional submissions (2)'));
    });
    expect(screen.getByText('eval')).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Gallery view' }));
    });
    expect(screen.getByText('eval')).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    // The primary feed's own toast/announcement bookkeeping is untouched by the
    // secondary surface's independent poll.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.getByText('eval')).toBeInTheDocument();
  });

  it('is additive only -- a bounty task never renders the benchmark secondary surface', () => {
    mockAccount.address = REQUESTER;
    submissionsState.value = [submission('sub-1', WORKER_A)];

    render(
      <LiveActivityPanel
        initialModeData={{ submissions: [] }}
        marketStats={null}
        profileBasePath="/dashboard/agents"
        submissionReviewEligible
        task={{
          ...task,
          auctionType: null,
          mode: 'bounty',
          submissionCount: 1,
        }}
      />
    );

    expect(screen.queryByTestId('benchmark-submission-review')).not.toBeInTheDocument();
    expect(screen.queryByText(/additional submissions/i)).not.toBeInTheDocument();
  });
});
