import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArtifactResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskResponse,
} from '@taskmarket/shared';
import { getAgentName } from '@taskmarket/shared';
import {
  CreateTaskPanel,
  TaskDetailPanel,
  TaskFilterRail,
  TaskListPageContent,
  TaskTable,
  taskFullTitle,
  taskTitle,
} from './tasks';
import { getAcceptWorkerAddress } from './actions/accept-button';
import { compactAddress } from '@/lib/format';

function compactAddressLabel(value: string) {
  return compactAddress(value);
}

const { refreshSpy, stubQuery } = vi.hoisted(() => ({
  refreshSpy: vi.fn(),
  stubQuery: (_input: unknown, options?: { initialData?: unknown }) => ({
    data: options?.initialData,
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/tasks',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshSpy,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// The live activity feed seeds its per-mode queries from the SSR mode data and
// only polls for the requester; in these static-render tests we mirror that by
// returning the provided initialData verbatim.
vi.mock('@/lib/api/client', () => ({
  trpc: {
    bids: { listByTask: { useQuery: stubQuery } },
    pitches: { listByTask: { useQuery: stubQuery } },
    proofs: { listByTask: { useQuery: stubQuery } },
    submissions: { listByTask: { useQuery: stubQuery } },
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn() }),
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
    <a data-next-link="true" href={href} {...props}>
      {children}
    </a>
  ),
}));

const { mockAccount, mockFund, mockPrivyConnect } = vi.hoisted(() => ({
  mockAccount: {
    address: undefined as string | undefined,
    isConnected: false,
  },
  mockFund: vi.fn(),
  mockPrivyConnect: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund: mockFund }),
  usePrivy: () => ({
    connectOrCreateWallet: mockPrivyConnect,
    ready: true,
  }),
}));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
});

afterEach(() => {
  mockAccount.address = undefined;
  mockAccount.isConnected = false;
  mockFund.mockClear();
  mockPrivyConnect.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
  mode: 'auction',
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
  auctionType: 'english',
  auctionBidCount: 2,
  submissionWindowOpen: true,
  phase: 'active',
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

function makeArtifact(overrides: Partial<ArtifactResponse>): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'artifact.png',
    id: 'artifact-1',
    keccak256Hash: '0xkeccak',
    mediaKind: 'image',
    mimeType: 'image/png',
    role: 'preview',
    sha256Hash: 'sha256',
    sizeBytes: 1024,
    storageUri: 's3://bucket/artifact.png',
    submissionId: 'sub-1',
    taskId: task.id,
    workerAddress: '0x3333333333333333333333333333333333333333',
    workerAgentId: null,
    ...overrides,
  };
}

function renderBountyArtifacts(artifacts: ArtifactResponse[]) {
  return renderReviewSubmissions([
    {
      artifacts,
      fileUrl: 'ipfs://deliverable',
      id: 'sub-1',
      signature: '0xsig',
      submittedAt: new Date().toISOString(),
      taskId: task.id,
      workerAddress: '0x3333333333333333333333333333333333333333',
    },
  ]);
}

function renderReviewSubmissions(submissions: SubmissionResponse[]) {
  return render(
    <TaskDetailPanel
      modeData={{
        submissions,
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
        submissionCount: submissions.length,
      }}
    />
  );
}

function mockPreviewFetch(previewUrl: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: async () => ({ expiresAt: new Date(Date.now() + 3_600_000).toISOString(), previewUrl }),
    ok: true,
  } as Response);
}

describe('taskTitle', () => {
  it('strips markdown emphasis, backticks, and heading markers from the first line', () => {
    expect(taskTitle({ ...task, description: '**QETEB MERIRI — the Noonday Destroyer**' })).toBe(
      'QETEB MERIRI — the Noonday Destroyer'
    );
    expect(taskTitle({ ...task, description: '# Build a `Node.js` service\nDetails' })).toBe(
      'Build a Node.js service'
    );
  });

  it('keeps underscores so snake_case identifiers survive', () => {
    expect(taskTitle({ ...task, description: 'Re-timestamp task_drops journal entries' })).toBe(
      'Re-timestamp task_drops journal entries'
    );
  });

  it('falls back to the task id when stripping leaves nothing', () => {
    expect(taskTitle({ ...task, description: '**' })).toBe(`Task ${task.id}`);
  });

  it('truncates with a trailing ellipsis past 80 characters instead of cutting silently', () => {
    const longFirstLine = 'A'.repeat(90);
    const capped = taskTitle({ ...task, description: longFirstLine });
    expect(capped).toHaveLength(80);
    expect(capped.endsWith('…')).toBe(true);
    expect(capped.startsWith('A'.repeat(79))).toBe(true);
  });

  it('does not add an ellipsis when the title is short enough to fit', () => {
    expect(taskTitle({ ...task, description: 'Short title' }).endsWith('…')).toBe(false);
  });
});

describe('taskFullTitle', () => {
  it('returns the untruncated first line even past the 80-character cap', () => {
    const longFirstLine = `${'A'.repeat(90)} tail-marker`;
    expect(taskFullTitle({ ...task, description: longFirstLine })).toBe(longFirstLine);
  });

  it('falls back to the task id when stripping leaves nothing', () => {
    expect(taskFullTitle({ ...task, description: '**' })).toBe(`Task ${task.id}`);
  });
});

describe('Task marketplace components', () => {
  it('renders populated, empty, loading, and error task table states', () => {
    const { rerender } = render(<TaskTable tasks={[task]} />);
    const taskLinks = screen.getAllByRole('link', { name: /summarize protocol feedback/i });
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('table').closest('[data-slot="card"]')).toBeNull();
    expect(taskLinks.at(0)).toHaveAttribute('href', '/dashboard/tasks/0xabc123');
    expect(taskLinks.at(0)).toHaveAttribute('data-next-link', 'true');
    expect(screen.getByRole('list', { name: /task cards/i })).toBeInTheDocument();
    expect(screen.getAllByText(/requester/i).length).toBeGreaterThan(0);
    // Listing reward splits the amount and the de-emphasised USDC unit into separate nodes.
    expect(screen.getAllByText('25').length).toBeGreaterThan(0);

    rerender(<TaskTable tasks={[]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no tasks yet/i).closest('[data-slot="card"]')).toHaveClass(
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

    rerender(<TaskTable listHref="/tasks" tasks={[]} errorMessage="Network failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network failed');
    expect(screen.getByRole('link', { name: /reload/i })).toHaveAttribute('href', '/tasks');
  });

  it('renders the gallery view as uniform whole-card cover links to the detail page', () => {
    render(<TaskTable tasks={[task]} view="gallery" />);

    // The gallery grid keeps its testid and accessible name.
    const gallery = screen.getByTestId('task-gallery');
    expect(gallery).toHaveAttribute('aria-label', 'Task gallery');

    // The whole card is a single link to the detail page (no separate title/footer links).
    const cardLinks = within(gallery).getAllByRole('link');
    expect(cardLinks).toHaveLength(1);
    expect(cardLinks[0]).toHaveAttribute('href', '/dashboard/tasks/0xabc123');

    // The cover container is a uniform 4:3 tile and the title lives in its overlay.
    expect(gallery.querySelector('.aspect-\\[4\\/3\\]')).not.toBeNull();
    expect(within(gallery).getByText(/summarize protocol feedback/i)).toBeInTheDocument();
    expect(within(gallery).getAllByText('25').length).toBeGreaterThan(0);
  });

  it('renders aspect-ratio gallery skeletons while loading in the gallery view', () => {
    render(<TaskTable isLoading tasks={[]} view="gallery" />);

    const loading = screen.getByRole('list', { name: /loading task gallery/i });
    expect(loading.querySelectorAll('.aspect-\\[4\\/3\\]').length).toBeGreaterThan(0);
    // The gallery loading state does not fall back to the table "Loading tasks" card.
    expect(screen.queryByText(/loading tasks/i)).not.toBeInTheDocument();
  });

  it('renders due/activity columns, colour-coded status, and the requester actor signal', () => {
    render(<TaskTable tasks={[{ ...task, requesterActorType: 'human' }]} />);

    expect(screen.getByRole('columnheader', { name: /^due$/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^activity$/i })).toBeInTheDocument();

    const openBadges = screen.getAllByText(/^open$/i);
    expect(
      openBadges.some(
        (node) => node.closest('[data-slot="badge"]')?.getAttribute('data-variant') === 'success'
      )
    ).toBe(true);

    expect(screen.getAllByText('2 bids').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^human$/i).length).toBeGreaterThan(0);
  });

  it('exposes sort controls that preserve the active filters', () => {
    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'auction',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
          taskDropId: 'launch-drop',
        }}
        tasks={[task]}
      />
    );

    expect(screen.getByRole('link', { name: /reward: high/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&taskDropId=launch-drop&sort=reward_desc'
    );
  });

  it('renders cursor pagination that preserves filters and supports back links', () => {
    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'auction',
          selectedSort: 'newest',
          selectedStatus: 'open',
          taskDropId: 'launch-drop',
        }}
        pagination={{
          currentCursor: '2026-06-10T09:00:00.000Z',
          cursorStack: '2026-06-11T09:00:00.000Z',
          hasMore: true,
          nextCursor: '2026-06-09T09:00:00.000Z',
        }}
        tasks={[task]}
      />
    );

    const pagination = screen.getByRole('navigation', { name: /task pagination/i });
    expect(within(pagination).getByRole('link', { name: /page 3/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(pagination).getByRole('link', { name: /go to previous page/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&status=open&taskDropId=launch-drop&cursor=2026-06-11T09%3A00%3A00.000Z'
    );
    expect(within(pagination).getByRole('link', { name: /go to next page/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&status=open&taskDropId=launch-drop&cursor=2026-06-09T09%3A00%3A00.000Z&cursorStack=2026-06-11T09%3A00%3A00.000Z%2C2026-06-10T09%3A00%3A00.000Z'
    );
    expect(screen.getByRole('link', { name: /reward: high/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&status=open&taskDropId=launch-drop&sort=reward_desc'
    );
  });

  it('does not render cursor pagination for non-newest sorts', () => {
    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'ALL',
          selectedSort: 'reward_desc',
          selectedStatus: 'ALL',
        }}
        pagination={{
          hasMore: true,
          nextCursor: '2026-06-09T09:00:00.000Z',
        }}
        tasks={[task]}
      />
    );

    expect(screen.queryByRole('navigation', { name: /task pagination/i })).not.toBeInTheDocument();
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
        taskDropId="launch-drop"
      />
    );
    expect(screen.getByRole('link', { name: /all modes/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?status=open&tags=react&taskDropId=launch-drop&minReward=2&maxReward=20&deadlineHours=72'
    );
    expect(screen.getByRole('link', { name: /all statuses/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&tags=react&taskDropId=launch-drop&minReward=2&maxReward=20&deadlineHours=72'
    );
    expect(screen.getByRole('link', { name: /^human$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&status=open&tags=react&taskDropId=launch-drop&minReward=2&maxReward=20&deadlineHours=72&actor=human'
    );
    expect(screen.getByLabelText(/tags/i)).toHaveValue('react');
    expect(screen.getByLabelText(/task drop id/i)).toHaveValue('launch-drop');
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
        task={{
          ...taskDetail,
          currentLowestBid: '12000000',
          maxPrice: '25000000',
          tags: ['auction', 'open', 'research'],
        }}
      />
    );
    const breadcrumb = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(breadcrumb).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(breadcrumb).getByText(/summarize protocol feedback/i)).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: /task metrics/i });
    const metricCards = within(metrics).getAllByRole('article');
    expect(metricCards).toHaveLength(2);
    const rewardSummary = within(metrics).getByRole('article', { name: /reward summary/i });
    expect(within(rewardSummary).getByText(/^reward$/i)).toBeInTheDocument();
    // Auction reward metric surfaces the live operative price (lowest bid), not the static reward.
    expect(within(rewardSummary).getByText('12 USDC')).toBeInTheDocument();
    expect(within(rewardSummary).getByText(/lowest bid/i)).toBeInTheDocument();
    expect(within(rewardSummary).getByText(/^due$/i)).toBeInTheDocument();
    const statusSummary = within(metrics).getByRole('article', { name: /status summary/i });
    expect(within(statusSummary).getByText(/^status$/i)).toBeInTheDocument();
    expect(within(statusSummary).getByText(/accepting work/i)).toBeInTheDocument();
    expect(within(statusSummary).getByText(/^bids$/i)).toBeInTheDocument();
    expect(within(statusSummary).getByText('2 bids')).toBeInTheDocument();
    expect(metrics.closest('[data-slot="card"]')).toBeNull();
    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    expect(screen.getByText(/task reference/i).closest('[data-slot="card"]')).toBeNull();
    const reference = within(sidebar);
    expect(reference.getByText(/^requester$/i)).toBeInTheDocument();
    expect(reference.getByText(/settlement/i)).toBeInTheDocument();
    expect(reference.getByText(/auction pricing/i)).toBeInTheDocument();
    expect(reference.getByText(/history/i)).toBeInTheDocument();
    expect(reference.queryByText(/^reward$/i)).not.toBeInTheDocument();
    expect(reference.queryByText(/^activity$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/work requirements/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Summarize protocol feedback', { selector: 'p' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/^auction$/i)).toHaveLength(1);
    expect(screen.getAllByText(/^open$/i)).toHaveLength(1);
    expect(screen.getByText(/^research$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/english auction/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/lowest bid/i)).toBeInTheDocument();
    expect(screen.getAllByText('12 USDC').length).toBeGreaterThan(0);
    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/worker actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/who can run/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^result$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(`taskmarket task bid ${task.id} --price <n>`)).not.toHaveLength(0);
  });

  it('places task details directly below work requirements', () => {
    render(
      <TaskDetailPanel
        modeData={{}}
        task={{
          ...taskDetail,
          description: 'Summarize protocol feedback\nInclude a concise findings report.',
        }}
      />
    );

    const requirementsSection = screen.getByRole('heading', {
      name: /work requirements/i,
    }).parentElement;
    const detailsSection = screen.getByRole('heading', { name: /^details$/i }).parentElement;

    expect(requirementsSection?.nextElementSibling).toBe(detailsSection);
  });

  it('shows an estimated worker DREAMS bonus caption when the hook is attached', () => {
    render(
      <TaskDetailPanel
        modeData={{}}
        task={{
          ...taskDetail,
          dreamsPerUsdc: (10n * 10n ** 18n).toString(),
          bonusBps: 750,
          estimatedWorkerUsdBonusValue: '60000',
          estimatedWorkerDreamsBonus: (200n * 10n ** 18n).toString(),
        }}
      />
    );
    const metrics = screen.getByRole('region', { name: /task metrics/i });
    const rewardSummary = within(metrics).getByRole('article', { name: /reward summary/i });
    expect(
      within(rewardSummary).getByText(/~0.06 usdc.*~200 dreams worker bonus \(est\.\)/i)
    ).toBeInTheDocument();
  });

  it('omits the DREAMS bonus caption when no estimate is present', () => {
    render(<TaskDetailPanel modeData={{}} task={taskDetail} />);
    const metrics = screen.getByRole('region', { name: /task metrics/i });
    const rewardSummary = within(metrics).getByRole('article', { name: /reward summary/i });
    expect(within(rewardSummary).queryByText(/dreams bonus/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/worker actions/i)).not.toBeInTheDocument();
    expect(screen.getByText(`taskmarket task submit ${task.id} --file <path>`)).toBeInTheDocument();
    expect(screen.queryByText(/^CLI$/i)).not.toBeInTheDocument();

    const participation = screen.getByTestId('task-participation');
    const submissionsEmptyState = screen.getByText(/submissions will appear here/i);
    expect(
      participation.compareDocumentPosition(submissionsEmptyState) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(within(participation).getByRole('link', { name: /set up an agent/i })).toHaveAttribute(
      'href',
      `/dashboard/for-agents?source=task-detail&taskId=${task.id}`
    );
  });

  it('hides requester task controls for a connected non-requester', () => {
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    mockAccount.isConnected = true;

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
              action: 'update',
              command: `taskmarket task update ${task.id} [--reward <usdc>]`,
              role: 'requester',
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/no actions for this wallet/i)).toBeInTheDocument();
    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connected wallet cannot change this task/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires requester/i)).not.toBeInTheDocument();
    expect(screen.queryByText(`taskmarket task cancel ${task.id}`)).not.toBeInTheDocument();
    expect(screen.queryByText(/taskmarket task update/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel task$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reward \(usdc\)/i)).not.toBeInTheDocument();
  });

  it('shows requester task controls to the task requester', () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;

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
              action: 'update',
              command: `taskmarket task update ${task.id} [--reward <usdc>]`,
              role: 'requester',
            },
          ],
        }}
      />
    );

    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel task$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/reward \(usdc\)/i)).toBeInTheDocument();
    // The sidebar is reference-only now; requester controls live in the main column.
    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    expect(
      within(sidebar).queryByRole('button', { name: /^cancel task$/i })
    ).not.toBeInTheDocument();
    expect(within(sidebar).queryByLabelText(/reward \(usdc\)/i)).not.toBeInTheDocument();
  });

  it('prompts low-balance wallets to add USDC before paid task actions', async () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ balanceBaseUnits: '0', balanceUsdc: '0.000000' }),
        ok: true,
      })
    );

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
          ],
        }}
      />
    );

    expect(await screen.findByText(/wallet has 0\.000000 usdc/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel task$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
  });

  it('keeps open worker actions available to connected non-requesters', () => {
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    mockAccount.isConnected = true;

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
              action: 'claim',
              command: `taskmarket task claim ${task.id}`,
              role: 'worker',
            },
          ],
        }}
      />
    );

    expect(screen.getByRole('button', { name: /^claim task$/i })).toBeEnabled();
    expect(screen.queryByText(/connected wallet cannot change this task/i)).not.toBeInTheDocument();
  });

  it('shows pitch due date, pitch count, and worker selection context', () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;

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

    expect(
      within(screen.getByRole('region', { name: /task metrics/i })).getByText(/^due$/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/workers submit pitches/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 pitch/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `taskmarket task select-worker ${task.id} --pitch <pitchId> --worker <address>`
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/i can produce a concise protocol summary/i)).toBeInTheDocument();
  });

  it('shows pending approval submissions as a requester review queue with payout actions', () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;

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

    expect(screen.getAllByText(/awaiting requester review/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 submission/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /submission review/i })).toBeInTheDocument();
    expect(screen.getByText(/compare deliverables before releasing escrow/i)).toBeInTheDocument();
    expect(
      screen.getByRole('article', {
        name: `Submission from ${compactAddressLabel('0x3333333333333333333333333333333333333333')}`,
      })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/release payout/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/review the latest submission/i)).not.toBeInTheDocument();
  });

  it('paginates and sorts a large submission review queue', async () => {
    const user = userEvent.setup();
    const submissions: SubmissionResponse[] = Array.from({ length: 12 }, (_, index) => ({
      artifacts: [],
      fileUrl: 'ipfs://deliverable',
      id: `sub-${index}`,
      signature: '0xsig',
      // Oldest first in the seed order; index 0 is the oldest, index 11 the newest.
      submittedAt: new Date(Date.now() - (12 - index) * 60_000).toISOString(),
      taskId: task.id,
      workerAddress: `0x${(index + 1).toString().padStart(40, '0')}`,
      workerStats: {
        averageRating: 90,
        completedTasks: index,
        ratedTasks: index,
        totalStars: index * 90,
      },
    }));

    renderReviewSubmissions(submissions);

    // 12 submissions at 10 per page -> 2 pages, showing 1-10 first. Scope the
    // article query to submission cards -- the reward/status DetailMetric
    // summaries are also <article>s and would otherwise inflate the count.
    expect(screen.getByText('Showing 1-10 of 12')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Showing 11-12 of 12')).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(2);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /sort submissions/i }),
      'credibility'
    );
    // Sorting resets back to page 1, now ordered by most-experienced worker first
    // (index 11 has the highest completedTasks of the seed).
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    const mostExperiencedWorker = submissions[11]?.workerAddress ?? '';
    expect(
      screen.getAllByRole('link', { name: compactAddressLabel(mostExperiencedWorker) })[0]
    ).toBeInTheDocument();
  });

  it('renders pending approval submissions as media comparison cards', () => {
    renderReviewSubmissions([
      {
        artifacts: [
          makeArtifact({
            fileName: 'candidate-a.png',
            id: 'artifact-image-a',
            previewUrl: 'https://files.example.com/candidate-a.png',
            role: 'preview',
          }),
          makeArtifact({
            fileName: 'notes.txt',
            id: 'artifact-notes-a',
            mediaKind: 'text',
            mimeType: 'text/plain',
            role: 'source',
          }),
        ],
        fileUrl: 'ipfs://deliverable-a',
        id: 'sub-a',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x3333333333333333333333333333333333333333',
      },
      {
        artifacts: [
          makeArtifact({
            fileName: 'candidate-b.mp4',
            id: 'artifact-video-b',
            mediaKind: 'video',
            mimeType: 'video/mp4',
            previewUrl: 'https://files.example.com/candidate-b.mp4',
            role: 'preview',
          }),
        ],
        fileUrl: 'ipfs://deliverable-b',
        id: 'sub-b',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x4444444444444444444444444444444444444444',
      },
    ]);

    const comparison = screen.getByRole('region', { name: /artifact comparison/i });
    expect(within(comparison).getAllByRole('article', { name: /submission from/i })).toHaveLength(
      2
    );
    expect(within(comparison).getByAltText('candidate-a.png')).toHaveAttribute(
      'src',
      'https://files.example.com/candidate-a.png'
    );
    expect(
      within(comparison).getByRole('button', { name: /open candidate-a\.png preview/i })
    ).toBeInTheDocument();
    expect(
      within(comparison).getByRole('button', { name: /open candidate-b\.mp4 preview/i })
    ).toBeInTheDocument();
    // Supporting files sit behind a collapsed disclosure instead of an open list.
    expect(within(comparison).getByText(/supporting files \(1\)/i)).toBeInTheDocument();
    expect(within(comparison).getByText('notes.txt')).toBeInTheDocument();
  });

  it('opens batch-preview media artifacts without refetching the preview URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'logo.png',
        id: 'artifact-image',
        previewExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        previewUrl: 'https://files.example.com/logo.png',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /open logo\.png preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('logo.png')).toHaveAttribute(
      'src',
      'https://files.example.com/logo.png'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('refreshes expired batch-preview media URLs before opening the artifact', async () => {
    const fetchMock = mockPreviewFetch('https://files.example.com/logo-fresh.png');
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'logo.png',
        id: 'artifact-image',
        previewExpiresAt: new Date(Date.now() - 1_000).toISOString(),
        previewUrl: 'https://files.example.com/logo-expired.png',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /open logo\.png preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('logo.png')).toHaveAttribute(
      'src',
      'https://files.example.com/logo-fresh.png'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/${task.id}/artifacts/artifact-image/preview?taskId=${task.id}&artifactId=artifact-image`
    );

    fetchMock.mockRestore();
  });

  it('blocks pending approval payout release when the requester wallet needs funding', async () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ balanceBaseUnits: '0', balanceUsdc: '0.000000' }),
        ok: true,
      })
    );

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

    expect(await screen.findByText(/wallet has 0\.000000 usdc/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^release payout$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /add usdc/i })).toBeEnabled();
  });

  it('explains how disconnected requesters can release a pending payout', () => {
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

    const requirement = screen.getByRole('group', { name: /payout release requirement/i });
    expect(within(requirement).getByText(/only requester/i)).toBeInTheDocument();
    expect(
      within(requirement).getByText(
        compactAddressLabel('0x1111111111111111111111111111111111111111')
      )
    ).toBeInTheDocument();
    expect(within(requirement).getByRole('button', { name: /connect wallet/i })).toBeEnabled();
  });

  it('lets a wrong connected wallet switch before releasing payout', async () => {
    const user = userEvent.setup();
    mockAccount.address = '0x9999999999999999999999999999999999999999';
    mockAccount.isConnected = true;

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

    const requirement = screen.getByRole('group', { name: /payout release requirement/i });
    expect(within(requirement).getByText(/connected as/i)).toBeInTheDocument();
    expect(
      within(requirement).getByText(
        compactAddressLabel('0x9999999999999999999999999999999999999999')
      )
    ).toBeInTheDocument();
    expect(
      within(requirement).queryByRole('button', { name: /switch wallet/i })
    ).not.toBeInTheDocument();

    await user.click(within(requirement).getByText(/release payout options/i));
    await user.click(within(requirement).getByRole('button', { name: /switch wallet/i }));

    expect(mockPrivyConnect).toHaveBeenCalled();
  });

  it('previews image artifacts inline without opening a new window', async () => {
    const previewUrl = 'https://files.example.com/logo.png';
    const fetchMock = mockPreviewFetch(previewUrl);
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();

    renderBountyArtifacts([makeArtifact({ fileName: 'logo.png', id: 'artifact-image' })]);

    await user.click(screen.getByRole('button', { name: /open logo\.png preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'logo.png' })).toBeInTheDocument();
    expect(within(dialog).getByAltText('logo.png')).toHaveAttribute('src', previewUrl);
    expect(openMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/${task.id}/artifacts/artifact-image/preview?taskId=${task.id}&artifactId=artifact-image`
    );

    openMock.mockRestore();
    fetchMock.mockRestore();
  });

  it('previews markdown artifacts by fetching and rendering content from presigned URL', async () => {
    const mdContent = '# Delivery\nGenerated logo assets.';
    const presignedUrl = 'https://files.example.com/readme.md';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/artifacts/')) {
        return {
          json: async () => ({
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            previewUrl: presignedUrl,
          }),
          ok: true,
        } as Response;
      }
      return { text: async () => mdContent, ok: true } as Response;
    });
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'README.md',
        id: 'artifact-text',
        mediaKind: 'text',
        mimeType: 'text/markdown',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /^view$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Delivery/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/Generated logo assets/i)).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('shows archive artifact metadata with technical details collapsed behind disclosure', async () => {
    const previewUrl = 'https://files.example.com/submission.zip';
    const fetchMock = mockPreviewFetch(previewUrl);
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'submission.zip',
        id: 'artifact-archive',
        mediaKind: 'archive',
        mimeType: 'application/zip',
        role: 'final',
        sizeBytes: 4096,
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /^view$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('application/zip')).toBeInTheDocument();
    expect(within(dialog).getByText('4 KB')).toBeInTheDocument();
    expect(within(dialog).getByText(/technical details/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /open artifact/i })).toHaveAttribute(
      'href',
      previewUrl
    );

    fetchMock.mockRestore();
  });

  it('uses the accept action worker when the pending task has no assigned worker yet', () => {
    const workerAddress = '0x3333333333333333333333333333333333333333';

    expect(
      getAcceptWorkerAddress(
        {
          action: 'accept',
          command: `taskmarket task accept ${task.id} --worker ${workerAddress}`,
          role: 'requester',
        },
        {
          ...taskDetail,
          claimedBy: null,
        }
      )
    ).toBe(workerAddress);
  });

  it('contains long action CLI commands inside the actions card', () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;

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
              action: 'accept',
              command: `taskmarket task accept ${task.id} --worker 0x3333333333333333333333333333333333333333 --receipt 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`,
              role: 'requester',
            },
          ],
          status: 'pending_approval',
          submissionCount: 1,
        }}
      />
    );

    const cliCommand = screen.getByText(/taskmarket task accept/i);
    expect(cliCommand.closest('details')).toHaveClass('min-w-0');
    expect(cliCommand.closest('pre')).toHaveClass('max-w-full', 'overflow-x-auto');
  });

  it('shows rating quality guidance before the requester records feedback', () => {
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;

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
              action: 'rate',
              command: `taskmarket task rate ${task.id} --rating <0-100>`,
              role: 'requester',
            },
          ],
          primaryAward: {
            workerAddress: '0x3333333333333333333333333333333333333333',
            rating: null,
          },
          status: 'completed',
        }}
      />
    );

    expect(screen.getByText(/quality guide/i)).toBeInTheDocument();
    expect(screen.getByText(/90-100/i)).toBeInTheDocument();
    expect(screen.getByText(/complete, accurate, and easy to verify/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/accuracy, completeness, communication/i)
    ).toBeInTheDocument();
  });

  it('renders canonical split payouts, rating progress, and recipient-bound actions', () => {
    const primary = '0x2222222222222222222222222222222222222222';
    const secondary = '0x3333333333333333333333333333333333333333';
    const third = '0x4444444444444444444444444444444444444444';
    mockAccount.address = task.requester;
    mockAccount.isConnected = true;

    render(
      <TaskDetailPanel
        modeData={{ submissions: [] }}
        task={{
          ...taskDetail,
          awardCount: 3,
          awards: [
            {
              workerAddress: primary,
              workerAgentId: '101',
              workerActorType: 'agent',
              rank: 1,
              isPrimary: true,
              grossAmount: '2400000',
              workerPayment: '2280000',
              platformFee: '120000',
              settlementTxHash: '0xsettlement',
              settledAt: '2026-07-14T00:00:00.000Z',
              rating: 94,
            },
            {
              workerAddress: secondary,
              workerAgentId: null,
              workerActorType: 'human',
              rank: 2,
              isPrimary: false,
              grossAmount: '1000000',
              workerPayment: '950000',
              platformFee: '50000',
              settlementTxHash: '0xsettlement',
              settledAt: '2026-07-14T00:00:00.000Z',
              rating: null,
            },
            {
              workerAddress: third,
              workerAgentId: null,
              workerActorType: 'agent',
              rank: 3,
              isPrimary: false,
              grossAmount: '600000',
              workerPayment: '570000',
              platformFee: '30000',
              settlementTxHash: '0xsettlement',
              settledAt: '2026-07-14T00:00:00.000Z',
              rating: null,
            },
          ],
          auctionBidCount: null,
          auctionType: null,
          mode: 'bounty',
          pendingActions: [secondary, third].map((targetWorker) => ({
            action: 'rate' as const,
            command: `taskmarket task rate ${task.id} --worker ${targetWorker} --rating <0-100>`,
            role: 'requester' as const,
            targetWorker,
          })),
          primaryAward: { workerAddress: primary, rating: 94 },
          reward: '4000000',
          status: 'completed',
        }}
      />
    );

    const payouts = screen.getByRole('region', { name: /settlement payouts/i });
    expect(within(payouts).getByText('3 winners')).toBeInTheDocument();
    expect(within(payouts).getByText('2.4 USDC')).toBeInTheDocument();
    expect(within(payouts).getByText('2.28 USDC')).toBeInTheDocument();
    expect(within(payouts).getByText('0.12 USDC')).toBeInTheDocument();
    expect(within(payouts).getAllByText('Pending')).toHaveLength(2);
    expect(screen.getAllByText('1 of 3 rated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 winners').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Assignment')).not.toBeInTheDocument();
    expect(screen.getAllByText(compactAddressLabel(secondary)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(compactAddressLabel(third)).length).toBeGreaterThan(0);
  });

  it('keeps metrics and reference data visible when activity and actions are empty', () => {
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
    expect(screen.getByRole('region', { name: /task metrics/i })).toBeInTheDocument();
    expect(screen.getByText(/task reference/i)).toBeInTheDocument();
    expect(screen.getByText(/settlement/i)).toBeInTheDocument();
    expect(screen.getByText(/history/i)).toBeInTheDocument();
    expect(screen.getAllByText('25 USDC').length).toBeGreaterThan(0);
  });

  it('links task detail actors to their profiles using the dashboard base path', () => {
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
        }}
        task={taskDetail}
      />
    );

    const requesterLink = screen.getByRole('link', {
      name: compactAddressLabel(task.requester),
    });
    expect(requesterLink).toHaveAttribute(
      'href',
      `/dashboard/agents/${encodeURIComponent(task.requester)}`
    );

    const bidderLink = screen.getByRole('link', {
      name: compactAddressLabel('0x2222222222222222222222222222222222222222'),
    });
    expect(bidderLink).toHaveAttribute(
      'href',
      `/dashboard/agents/${encodeURIComponent('0x2222222222222222222222222222222222222222')}`
    );
  });

  it('links task detail actors to public agent profiles when given a public base path', () => {
    render(
      <TaskDetailPanel
        backHref="/tasks"
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
        profileBasePath="/agents"
        task={{
          ...taskDetail,
          auctionBidCount: null,
          auctionType: null,
          mode: 'bounty',
          pendingActions: [],
        }}
      />
    );

    const workerLink = screen.getByRole('link', {
      name: compactAddressLabel('0x3333333333333333333333333333333333333333'),
    });
    expect(workerLink).toHaveAttribute(
      'href',
      `/agents/${encodeURIComponent('0x3333333333333333333333333333333333333333')}`
    );
  });

  it('links the task mode and tags to filtered task lists', () => {
    render(
      <TaskDetailPanel
        backHref="/dashboard/tasks"
        modeData={{ bids: [] }}
        task={{
          ...taskDetail,
          tags: ['research', 'analysis'],
        }}
      />
    );

    const modeLink = screen
      .getAllByText('auction')
      .map((node) => node.closest('a'))
      .find((node): node is HTMLAnchorElement => node !== null);
    expect(modeLink).toHaveAttribute('href', '/dashboard/tasks?mode=auction');

    const tagLink = screen.getByText('research').closest('a');
    expect(tagLink).toHaveAttribute('href', '/dashboard/tasks?tags=research');
  });

  it('shows the mode explainer link on dashboard and public task surfaces', () => {
    const { rerender } = render(
      <TaskDetailPanel backHref="/dashboard/tasks" modeData={{ bids: [] }} task={taskDetail} />
    );
    expect(screen.getAllByRole('link', { name: /how this works/i })).not.toHaveLength(0);
    for (const link of screen.getAllByRole('link', { name: /how this works/i })) {
      expect(link).toHaveAttribute('href', '/dashboard/task-types');
    }

    rerender(<TaskDetailPanel backHref="/tasks" modeData={{ bids: [] }} task={taskDetail} />);
    expect(screen.getAllByRole('link', { name: /how this works/i })).not.toHaveLength(0);
    for (const link of screen.getAllByRole('link', { name: /how this works/i })) {
      expect(link).toHaveAttribute('href', '/dashboard/task-types');
    }
  });

  it('prefers the requester agent id over the wallet address in the reference sidebar', () => {
    render(
      <TaskDetailPanel modeData={{ bids: [] }} task={{ ...taskDetail, requesterAgentId: '42' }} />
    );

    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.queryByText('Wallet')).not.toBeInTheDocument();
    expect(screen.queryByText(compactAddressLabel(task.requester))).not.toBeInTheDocument();
    const requesterLink = screen.getByRole('link', { name: getAgentName('42') ?? 'Agent #42' });
    expect(requesterLink).toHaveAttribute('href', '/dashboard/agents/42');
  });

  it('falls back to the wallet label when the requester has no registered agent id', () => {
    render(<TaskDetailPanel modeData={{ bids: [] }} task={taskDetail} />);

    expect(screen.getByText('Wallet')).toBeInTheDocument();
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
  });

  it('never shows the workable phase chip for an open task past its expiry', () => {
    render(
      <TaskDetailPanel
        modeData={{ bids: [] }}
        task={{
          ...taskDetail,
          expiryTime: new Date(Date.now() - 3_600_000).toISOString(),
          status: 'open',
        }}
      />
    );

    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByText('Workable')).not.toBeInTheDocument();
  });

  it('gives the two copy-for-agent buttons distinct, real hover labels', () => {
    render(<TaskDetailPanel modeData={{ bids: [] }} task={taskDetail} />);

    expect(screen.getByRole('button', { name: 'Copy as JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy as markdown' })).toBeInTheDocument();
  });

  it('adds an ellipsis and a hover title once a title is long enough to truncate', () => {
    const longDescription = `${'A very long task title with a github url '.repeat(4)}https://github.com/example/repo`;
    render(
      <TaskDetailPanel
        modeData={{ bids: [] }}
        task={{ ...taskDetail, description: longDescription }}
      />
    );

    const capped = taskTitle({ ...taskDetail, description: longDescription });
    const full = taskFullTitle({ ...taskDetail, description: longDescription });
    expect(capped).not.toBe(full);
    expect(capped.endsWith('…')).toBe(true);

    const heading = screen.getByRole('heading', { level: 1, name: capped });
    expect(heading).toHaveAttribute('title', full);
    expect(heading.className).toContain('break-words');
    expect(screen.getByText(capped, { selector: '[data-slot="breadcrumb-page"]' })).toHaveAttribute(
      'title',
      full
    );
  });
});
