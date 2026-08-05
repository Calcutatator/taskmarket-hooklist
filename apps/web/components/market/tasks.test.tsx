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
import { CreateTaskPanel, TaskDetailPanel, TaskListPageContent, TaskTable } from './tasks';
import { getAcceptWorkerAddress } from './actions/accept-button';
import { compactAddress } from '@/lib/format';
import { taskFullTitle, taskTitle } from '@/lib/market/task-title';
import { MAX_INTERACTIVE_HTML_BYTES } from '@/lib/sandboxed-html';

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
  READ_AUTH_CONTEXT_KEY: 'taskmarketReadAuth',
  trpc: {
    bids: { listByTask: { useQuery: stubQuery } },
    pitches: { listByTask: { useQuery: stubQuery } },
    proofs: { listByTask: { useQuery: stubQuery } },
    submissions: { listByTask: { useQuery: stubQuery } },
    useUtils: () => ({
      submissions: {
        listByTask: {
          invalidate: vi.fn(),
        },
      },
    }),
  },
}));

vi.mock('@/lib/use-read-auth-signature', () => ({
  useReadAuthSignature: () => false,
  // Every paid action's `useInFlightWrite` asks for one, so the whole module must be stubbed.
  useReadAuthSignatureState: () => ({
    error: null,
    ready: false,
    requestSignature: () => {},
    status: 'idle',
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn() }),
}));

// vaul drives its bottom-sheet drag gesture off Pointer Events + CSS transform APIs
// jsdom does not implement. The mock keeps the mobile filter shell and contents
// rendered so its layout contract and URL-backed controls remain testable.
vi.mock('vaul', () => {
  function Root({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function Trigger(props: Record<string, unknown>) {
    return <button type="button" {...props} />;
  }
  function Portal({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function Overlay(props: Record<string, unknown>) {
    return <div {...props} />;
  }
  function Close(props: Record<string, unknown>) {
    return <button type="button" {...props} />;
  }
  function Content(props: Record<string, unknown>) {
    return <div role="dialog" {...props} />;
  }
  function Title(props: Record<string, unknown>) {
    return <h2 {...props} />;
  }
  function Description(props: Record<string, unknown>) {
    return <p {...props} />;
  }

  return {
    Drawer: { Root, Trigger, Portal, Overlay, Close, Content, Title, Description },
  };
});

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

const { mockAccount, mockAuth, mockFund, mockPrivyConnect } = vi.hoisted(() => ({
  mockAccount: {
    address: undefined as string | undefined,
    isConnected: false,
  },
  mockAuth: {
    authenticated: false,
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
    authenticated: mockAuth.authenticated,
    connectOrCreateWallet: mockPrivyConnect,
    login: vi.fn(),
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
});

afterEach(() => {
  mockAccount.address = undefined;
  mockAccount.isConnected = false;
  mockAuth.authenticated = false;
  mockFund.mockClear();
  mockPrivyConnect.mockClear();
  FakeIntersectionObserver.instances = [];
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

// jsdom does not implement IntersectionObserver, and the interactive-HTML poster
// (SubmissionArtifactPoster) uses one to defer mounting a live sandboxed iframe
// until the tile is near the viewport. Stubbed locally per-test via
// vi.stubGlobal (cleaned up by the shared afterEach's vi.unstubAllGlobals()
// below) rather than in a global test setup file, so unrelated suites that
// render the same poster keep exercising the real "no observer support"
// fallback instead of silently having it stubbed out for them too.
class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  root: Element | Document | null = null;
  rootMargin = '';
  scrollMargin = '';
  thresholds: number[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);

  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
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
    const mobileTaskList = screen.getByRole('list', { name: /task cards/i });
    const taskListFrame = mobileTaskList.parentElement;
    expect(mobileTaskList).toHaveClass('gap-2');
    expect(mobileTaskList).not.toHaveClass('p-3');
    expect(taskListFrame).not.toHaveClass('border');
    expect(taskListFrame).toHaveClass('md:border');
    expect(taskListFrame).toHaveClass('md:rounded-lg');
    expect(taskListFrame).toHaveClass('md:bg-card/38');
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

    // The cover container is taller on mobile and a uniform 4:3 tile at sm+, and the
    // title lives in its overlay.
    expect(gallery.querySelector('.aspect-\\[4\\/5\\].sm\\:aspect-\\[4\\/3\\]')).not.toBeNull();
    expect(within(gallery).getByText(/summarize protocol feedback/i)).toBeInTheDocument();
    expect(within(gallery).getAllByText('25').length).toBeGreaterThan(0);
  });

  it('renders aspect-ratio gallery skeletons while loading in the gallery view', () => {
    render(<TaskTable isLoading tasks={[]} view="gallery" />);

    const loading = screen.getByRole('list', { name: /loading task gallery/i });
    expect(
      loading.querySelectorAll('.aspect-\\[4\\/5\\].sm\\:aspect-\\[4\\/3\\]').length
    ).toBeGreaterThan(0);
    // The gallery loading state does not fall back to the table "Loading tasks" card.
    expect(screen.queryByText(/loading tasks/i)).not.toBeInTheDocument();
  });

  it('adapts the gallery feed for full-bleed, one-per-screen mobile scrolling while keeping the sm+ grid', () => {
    render(<TaskTable tasks={[task]} view="gallery" />);

    const gallery = screen.getByTestId('task-gallery');

    // Full-bleed on mobile: cancel the page's horizontal gutter just for the feed,
    // restored once the sm+ multi-column grid kicks back in.
    expect(gallery).toHaveClass('-mx-4');
    expect(gallery).toHaveClass('sm:mx-0');

    // Snap-scrolling is mobile-only; the sm+ grid never snaps.
    expect(gallery).toHaveClass('snap-y');
    expect(gallery).toHaveClass('snap-mandatory');
    expect(gallery).toHaveClass('sm:snap-none');

    // The multi-column grid at sm+ is unchanged.
    expect(gallery).toHaveClass('sm:grid-cols-2');
    expect(gallery).toHaveClass('lg:grid-cols-3');
    expect(gallery).toHaveClass('2xl:grid-cols-4');

    const item = within(gallery).getByRole('listitem');
    expect(item).toHaveClass('snap-start');
    expect(item).toHaveClass('sm:snap-align-none');
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

  it('renders each compact mobile task as one obvious detail link with at least a 144px minimum height', () => {
    render(<TaskTable tasks={[task]} />);

    const mobileList = screen.getByRole('list', { name: /task cards/i });
    const detailLinks = within(mobileList).getAllByRole('link');

    expect(detailLinks).toHaveLength(1);
    expect(detailLinks[0]).toHaveAttribute('href', '/dashboard/tasks/0xabc123');
    // A minimum height (not a fixed height) keeps cards visually consistent while still
    // letting a two-line title or a long status label grow the card instead of clipping.
    expect(detailLinks[0]).toHaveClass('min-h-36');
    expect(detailLinks[0]).not.toHaveClass('h-36');
    expect(within(mobileList).getByText(/summarize protocol feedback/i)).toBeInTheDocument();
    expect(within(mobileList).getByText(/^auction$/i)).toBeInTheDocument();
    expect(within(mobileList).getByText(/^open$/i)).toBeInTheDocument();
    expect(within(mobileList).getByText(/2 bids/i)).toBeInTheDocument();
    expect(within(mobileList).getByText(/^due$/i)).toBeInTheDocument();
    expect(within(mobileList).getByText(/^reward$/i)).toBeInTheDocument();
    expect(within(mobileList).getByText(/view task/i)).toBeInTheDocument();
  });

  it('lets the mobile card status row wrap instead of letting a long status label overprint the activity count', () => {
    render(
      <TaskTable
        tasks={[{ ...task, mode: 'bounty', status: 'pending_approval', submissionCount: 2 }]}
      />
    );

    const mobileList = screen.getByRole('list', { name: /task cards/i });
    const detailLink = within(mobileList).getByRole('link');
    const statusRow = detailLink.firstElementChild as HTMLElement;

    // A long status label ("Awaiting buyer review") must not share a no-wrap flex row
    // with the activity count -- that pairing is what let the badge overprint the count.
    expect(statusRow).toHaveClass('flex-wrap');
    expect(statusRow).not.toHaveClass('justify-between');

    // Right-aligns itself via margin so it still reads correctly whether it shares the
    // first line with the badges or wraps onto a line of its own.
    const activityCount = within(mobileList).getByText(/2 submissions/i);
    expect(activityCount).toHaveClass('ml-auto');
    expect(within(mobileList).getByText(/awaiting buyer review/i)).toBeInTheDocument();
  });

  it('keeps compact task facts in the mobile detail link accessible name', () => {
    render(<TaskTable tasks={[task]} />);

    const mobileList = screen.getByRole('list', { name: /task cards/i });
    const detailLink = within(mobileList).getByRole('link');

    expect(detailLink).toHaveAccessibleName(/auction.*open.*2 bids.*reward.*due.*view task/i);
  });

  it('exposes a sort dropdown that preserves the active filters', async () => {
    const user = userEvent.setup();

    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'auction',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
          selectedView: 'gallery',
          taskDropId: 'launch-drop',
        }}
        tasks={[task]}
      />
    );

    const toolbar = screen.getByTestId('task-toolbar');
    const sortTrigger = within(toolbar).getByRole('button', { name: /sort: newest/i });
    await user.click(sortTrigger);
    expect(screen.getByRole('menuitem', { name: /reward: high/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&taskDropId=launch-drop&sort=reward_desc&view=gallery'
    );
  });

  it('renders cursor pagination that preserves filters and supports back links', async () => {
    const user = userEvent.setup();

    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'auction',
          selectedSort: 'newest',
          selectedStatus: 'open',
          selectedView: 'gallery',
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
      '/dashboard/tasks?mode=auction&status=open&taskDropId=launch-drop&view=gallery&cursor=2026-06-11T09%3A00%3A00.000Z'
    );
    expect(within(pagination).getByRole('link', { name: /go to next page/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&status=open&taskDropId=launch-drop&view=gallery&cursor=2026-06-09T09%3A00%3A00.000Z&cursorStack=2026-06-11T09%3A00%3A00.000Z%2C2026-06-10T09%3A00%3A00.000Z'
    );
    const sortTrigger = within(screen.getByTestId('task-toolbar')).getByRole('button', {
      name: /sort: newest/i,
    });
    await user.click(sortTrigger);
    expect(screen.getByRole('menuitem', { name: /reward: high/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&status=open&taskDropId=launch-drop&sort=reward_desc&view=gallery'
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

  describe('mobile-default feed view', () => {
    it('renders the compact list when no explicit view param is set', () => {
      render(
        <TaskListPageContent
          activeFilters={[]}
          filterParams={{ selectedMode: 'ALL', selectedSort: 'newest', selectedStatus: 'ALL' }}
          tasks={[task]}
        />
      );

      expect(screen.queryByTestId('task-gallery')).not.toBeInTheDocument();
      expect(screen.getByRole('list', { name: /task cards/i })).toBeInTheDocument();
    });

    it('honours an explicit ?view=gallery preference', () => {
      render(
        <TaskListPageContent
          activeFilters={[]}
          filterParams={{
            selectedMode: 'ALL',
            selectedSort: 'newest',
            selectedStatus: 'ALL',
            selectedView: 'gallery',
          }}
          tasks={[task]}
        />
      );

      expect(screen.getByTestId('task-gallery')).toBeInTheDocument();
    });
  });

  it('keeps the desktop browse controls together inside the results frame', () => {
    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'ALL',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
        }}
        tasks={[task]}
      />
    );

    const frame = screen.getByTestId('task-results-frame');
    const toolbar = screen.getByTestId('task-toolbar');
    expect(frame).toContainElement(toolbar);
    expect(within(toolbar).getByText('Filters')).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: /mode: all modes/i })).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /status: all statuses/i })
    ).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: /actor: any/i })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: /sort: newest/i })).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: /table view/i })).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: /gallery view/i })).toBeInTheDocument();
  });

  it('keeps filter, sort, view, and clear actions in one icon-only mobile row', async () => {
    const user = userEvent.setup();

    render(
      <TaskListPageContent
        activeFilters={[
          { label: 'Mode', value: 'auction' },
          { label: 'Task Drop', value: 'launch-drop' },
        ]}
        filterParams={{
          selectedMode: 'auction',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
          taskDropId: 'launch-drop',
        }}
        tasks={[task]}
      />
    );

    const toolbar = screen.getByTestId('mobile-task-toolbar');
    expect(toolbar).toHaveClass('grid-cols-5');
    expect(toolbar).toHaveClass('lg:hidden');
    const heading = screen.getByRole('heading', { name: /open tasks/i });
    const postTask = screen.getByRole('link', { name: /post task/i });
    expect(heading).toHaveClass('text-2xl');
    expect(heading).toHaveClass('sm:text-4xl');
    expect(postTask).toHaveClass('size-11');
    expect(postTask.querySelector('svg')).not.toBeNull();
    expect(within(postTask).getByText('Post task')).toHaveClass('hidden', 'sm:inline');
    expect(
      within(toolbar).getByText('2', { selector: '[aria-label="2 active filters"]' })
    ).toBeInTheDocument();

    const filterTrigger = within(toolbar).getByRole('button', {
      name: /filters, 2 active filters/i,
    });
    const listLink = within(toolbar).getByRole('link', { name: /list view/i });
    const galleryLink = within(toolbar).getByRole('link', { name: /gallery view/i });
    const clearLink = within(toolbar)
      .getAllByRole('link', { name: /clear filters/i })
      .find((link) => link.querySelector('svg'));
    expect(clearLink).toBeDefined();
    expect(filterTrigger.querySelector('svg')).not.toBeNull();
    expect(listLink).toHaveAttribute('aria-current', 'page');
    expect(listLink).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&taskDropId=launch-drop'
    );
    expect(galleryLink).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&taskDropId=launch-drop&view=gallery'
    );
    expect(listLink).toHaveClass('min-h-11');
    expect(galleryLink).toHaveClass('min-h-11');
    expect(within(listLink).getByText('List')).toHaveClass('sr-only');
    expect(within(galleryLink).getByText('Gallery')).toHaveClass('sr-only');
    expect(clearLink).toHaveAttribute('href', '/dashboard/tasks');
    expect(clearLink?.querySelector('svg')).not.toBeNull();

    const sortTrigger = within(toolbar).getByRole('button', { name: /sort tasks.*newest/i });
    expect(sortTrigger.querySelector('svg')).not.toBeNull();
    expect(sortTrigger).not.toHaveTextContent('Newest');
    sortTrigger.focus();
    await user.keyboard('{Enter}');
    const rewardSort = await screen.findByRole('menuitem', { name: /reward: high/i });
    expect(rewardSort).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction&taskDropId=launch-drop&sort=reward_desc'
    );
    expect(rewardSort).toHaveClass('min-h-11');
    await user.keyboard('{Escape}');
    expect(sortTrigger).toHaveFocus();
  });

  it('bounds the mobile filter drawer and keeps actions outside its scrolling body', async () => {
    const user = userEvent.setup();

    render(
      <TaskListPageContent
        activeFilters={[]}
        filterParams={{
          selectedMode: 'ALL',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
        }}
        pagination={{ hasMore: true, nextCursor: 'next-page' }}
        tasks={[task]}
      />
    );

    const drawer = screen.getByRole('dialog');
    const drawerBody = within(drawer).getByTestId('mobile-task-filter-body');
    const advanced = within(drawer).getByText('Advanced filters').closest('details');

    expect(drawer).toHaveClass('max-h-[calc(100dvh-0.5rem)]');
    expect(drawer).toHaveClass('overflow-hidden');
    expect(drawerBody).toHaveClass('min-h-0');
    expect(drawerBody).toHaveClass('flex-1');
    expect(drawerBody).toHaveClass('overflow-y-auto');
    expect(advanced).not.toHaveAttribute('open');
    const advancedSummary = within(drawer).getByText('Advanced filters').closest('summary');
    advancedSummary?.focus();
    expect(advancedSummary).toHaveFocus();
    await user.click(advancedSummary as HTMLElement);
    expect(advanced).toHaveAttribute('open');
    const modeFilter = within(drawer).getByRole('button', { name: /mode: all modes/i });
    expect(modeFilter).toHaveClass('min-h-11');
    await user.click(modeFilter);
    expect(screen.getByRole('menuitem', { name: /all modes/i })).toHaveClass('min-h-11');
    await user.keyboard('{Escape}');
    expect(within(drawer).getByRole('link', { name: /clear filters/i })).toHaveClass('min-h-11');
    expect(within(drawer).getByRole('button', { name: /show 1\+ results/i })).toHaveAttribute(
      'form',
      'mobile-task-filter-form'
    );
  });

  it('opens advanced mobile filters when an advanced URL value is active', () => {
    render(
      <TaskListPageContent
        activeFilters={[{ label: 'Tags', value: 'react' }]}
        filterParams={{
          selectedMode: 'ALL',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
          tags: 'react',
        }}
        tasks={[task]}
      />
    );

    const drawer = screen.getByRole('dialog');
    const advanced = within(drawer).getByText('Advanced filters').closest('details');

    expect(advanced).toHaveAttribute('open');
    expect(within(drawer).getByText('1 active')).toBeInTheDocument();
    expect(within(drawer).getByLabelText(/tags/i)).toHaveValue('react');
  });

  it('joins desktop filters, sort, view, and results in one full-width frame', async () => {
    const user = userEvent.setup();

    render(
      <TaskListPageContent
        activeFilters={[
          { label: 'Mode', value: 'auction' },
          { label: 'Tags', value: 'react' },
        ]}
        basePath="/tasks"
        filterParams={{
          selectedMode: 'auction',
          selectedSort: 'newest',
          selectedStatus: 'ALL',
          tags: 'react',
        }}
        listHref="/tasks"
        tasks={[task]}
      />
    );

    const frame = screen.getByTestId('task-results-frame');
    const desktopToolbar = within(frame).getByTestId('task-toolbar');
    expect(screen.queryByRole('complementary', { name: /task filters/i })).not.toBeInTheDocument();
    expect(frame).toContainElement(desktopToolbar);
    expect(frame).toContainElement(within(frame).getByRole('table'));

    const modeTrigger = within(desktopToolbar).getByRole('button', { name: /mode: auction/i });
    await user.click(modeTrigger);
    const selectedMode = screen.getByRole('menuitem', { name: /^auction$/i });
    expect(selectedMode).toHaveAttribute('aria-current', 'page');
    expect(selectedMode).toHaveAttribute('href', '/tasks?mode=auction&tags=react');
    await user.keyboard('{Escape}');

    const sortTrigger = within(desktopToolbar).getByRole('button', { name: /sort: newest/i });
    await user.click(sortTrigger);
    expect(screen.getByRole('menuitem', { name: /reward: high/i })).toHaveAttribute(
      'href',
      '/tasks?mode=auction&tags=react&sort=reward_desc'
    );
    await user.keyboard('{Escape}');
    expect(within(desktopToolbar).getByRole('link', { name: /gallery view/i })).toHaveAttribute(
      'href',
      '/tasks?mode=auction&tags=react&view=gallery'
    );

    const advanced = within(frame).getByTestId('task-advanced-filters');
    const advancedSummary = within(advanced).getByText('Advanced filters').closest('summary');
    expect(advanced).toHaveAttribute('open');
    expect(within(advanced).getByLabelText(/tags/i)).toHaveValue('react');

    advancedSummary?.focus();
    expect(advancedSummary).toHaveFocus();
    await user.click(advancedSummary as HTMLElement);
    expect(advanced).not.toHaveAttribute('open');
    await user.click(advancedSummary as HTMLElement);
    expect(advanced).toHaveAttribute('open');
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
    expect(
      screen.getByRole('heading', { level: 1, name: /summarize protocol feedback/i })
    ).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: /task metrics/i });
    const metricCards = within(metrics).getAllByRole('article');
    expect(metricCards).toHaveLength(4);
    expect(metrics).toHaveClass('grid-cols-2');
    expect(metrics).toHaveClass('md:grid-cols-4');
    expect(metricCards[0]).toHaveClass('p-3');
    expect(metricCards[0]).toHaveClass('md:p-5');
    const rewardSummary = within(metrics).getByRole('article', { name: /reward summary/i });
    expect(within(rewardSummary).getByText(/^reward$/i)).toBeInTheDocument();
    // Auction reward metric surfaces the live operative price (lowest bid), not the static reward.
    expect(within(rewardSummary).getByText('12 USDC')).toBeInTheDocument();
    expect(within(rewardSummary).getByText(/lowest bid/i)).toBeInTheDocument();
    const dueSummary = within(metrics).getByRole('article', { name: /due summary/i });
    const bidsSummary = within(metrics).getByRole('article', { name: /bids summary/i });
    expect(within(dueSummary).getByText(/^due$/i)).toBeInTheDocument();
    expect(within(bidsSummary).getByText(/^bids$/i)).toBeInTheDocument();
    expect(within(bidsSummary).getByText('2 bids')).toBeInTheDocument();
    expect(metrics.closest('[data-slot="card"]')).toBeNull();
    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    expect(screen.getByText(/task reference/i).closest('[data-slot="card"]')).toBeNull();
    const reference = within(sidebar);
    expect(reference.getByText(/^requester$/i)).toBeInTheDocument();
    expect(reference.getByText(/escrow tx/i)).toBeInTheDocument();
    expect(reference.getByText(/auction pricing/i)).toBeInTheDocument();
    expect(reference.getByText(/created/i)).toBeInTheDocument();
    expect(reference.queryByText(/^reward$/i)).not.toBeInTheDocument();
    expect(reference.queryByText(/^activity$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/work requirements/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Summarize protocol feedback', { selector: 'p' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/^auction$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^open$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^research$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/english auction/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/lowest bid/i)).toBeInTheDocument();
    expect(screen.getAllByText('12 USDC').length).toBeGreaterThan(0);
    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/worker actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/who can run/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^result$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(`taskmarket task bid ${task.id} --price <n>`)).not.toHaveLength(0);
    const primaryActions = screen
      .getAllByText(`taskmarket task bid ${task.id} --price <n>`)[0]
      .closest('section');
    const requirements = screen.getByRole('heading', { name: /work requirements/i }).parentElement;
    const primaryActionWrapper = screen.getByRole('heading', { name: /next actions/i })
      .parentElement?.parentElement;
    expect(primaryActionWrapper).toHaveClass('order-1');
    expect(primaryActionWrapper).toHaveClass('lg:order-2');
    expect(requirements).toHaveClass('order-2');
    expect(requirements).toHaveClass('lg:order-1');
    expect(
      primaryActions && requirements
        ? Boolean(
            primaryActions.compareDocumentPosition(requirements) & Node.DOCUMENT_POSITION_FOLLOWING
          )
        : false
    ).toBe(true);
  });

  it('gates the summary rail divider and inset to lg and up since the rail stacks full-width below the content on mobile', () => {
    render(<TaskDetailPanel modeData={{}} task={taskDetail} />);

    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    const rail = sidebar.firstElementChild as HTMLElement;

    // Below `lg` the aside stacks full-width under the main content, so an unconditional
    // left rule and inset render as orphaned decoration with nothing to their left.
    expect(rail).not.toHaveClass('border-l');
    expect(rail).not.toHaveClass('pl-5');
    expect(rail).toHaveClass('lg:border-l');
    expect(rail).toHaveClass('lg:pl-5');
  });

  it.each(['/dashboard/tasks', '/tasks'])(
    'renders a collapsed description preview before submission review on the %s surface',
    async (backHref) => {
      const user = userEvent.setup();
      render(
        <TaskDetailPanel
          backHref={backHref}
          modeData={{
            submissions: [
              {
                artifacts: [],
                fileUrl: 'ipfs://deliverable',
                id: 'sub-description-order',
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
            description:
              'Summarize protocol feedback\nInclude a concise findings report with direct references, implementation notes, edge cases, and enough supporting detail to make the recommendation actionable without additional research.',
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
            tags: ['research'],
          }}
        />
      );

      const description = screen.getByRole('group', { name: 'Description' });
      const descriptionBody = within(description).getByTestId('task-description-body');
      const activity = document.getElementById('task-activity');
      const tagLink = screen.getByRole('link', { name: 'research' });
      const toggle = within(description).getByRole('button', {
        name: 'Show full description',
      });

      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(descriptionBody).toHaveAttribute('data-collapsed', 'true');
      expect(descriptionBody).toHaveClass('max-h-[200px]', 'overflow-hidden');
      expect(within(description).getByTestId('task-description-fade')).toBeVisible();
      expect(within(description).getByText(/Include a concise findings report/i)).toBeVisible();
      expect(
        activity &&
          Boolean(description.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING)
      ).toBe(true);
      expect(description).not.toContainElement(tagLink);

      toggle.focus();
      expect(toggle).toHaveFocus();
      await user.click(toggle);

      expect(
        within(description).getByRole('button', { name: 'Collapse description' })
      ).toHaveAttribute('aria-expanded', 'true');
      expect(descriptionBody).toHaveAttribute('data-collapsed', 'false');
      expect(descriptionBody).not.toHaveClass('max-h-[200px]', 'overflow-hidden');
      expect(within(description).queryByTestId('task-description-fade')).not.toBeInTheDocument();
      expect(tagLink).toBeVisible();
    }
  );

  it('keeps structured brief sections intact inside the description disclosure', () => {
    render(
      <TaskDetailPanel
        modeData={{}}
        task={{
          ...taskDetail,
          description:
            'Summarize protocol feedback\nPrepare a concise findings report.\n\nDELIVERABLES\nOne report with cited findings.',
        }}
      />
    );

    const description = screen.getByRole('group', { name: 'Description' });
    const deliverables = within(description)
      .getByText('Deliverables')
      .closest('details') as HTMLDetailsElement;

    expect(within(description).getAllByText('Prepare a concise findings report.')).toHaveLength(2);
    expect(deliverables).toHaveAttribute('open');
    expect(within(deliverables).getByText('One report with cited findings.')).toBeInTheDocument();
  });

  it('does not render an empty description disclosure and keeps tags available', () => {
    render(
      <TaskDetailPanel
        backHref="/tasks"
        modeData={{}}
        task={{ ...taskDetail, description: 'Summarize protocol feedback', tags: ['research'] }}
      />
    );

    expect(screen.queryByRole('group', { name: 'Description' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'research' })).toHaveAttribute(
      'href',
      '/tasks?tags=research'
    );
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
    const bonusSummary = within(metrics).getByRole('article', {
      name: /estimated dreams bonus summary/i,
    });

    expect(within(rewardSummary).getByText('25 USDC')).toBeInTheDocument();
    expect(within(bonusSummary).getByText('+200 DREAMS')).toBeInTheDocument();
    expect(within(bonusSummary).getByText(/approximately 0.06 usdc/i)).toBeInTheDocument();
    expect(
      within(bonusSummary).getByRole('button', {
        name: /learn how dreams bonus eligibility works/i,
      })
    ).toBeInTheDocument();
  });

  it('omits the DREAMS bonus caption when no estimate is present', () => {
    render(<TaskDetailPanel modeData={{}} task={taskDetail} />);
    const metrics = screen.getByRole('region', { name: /task metrics/i });
    const rewardSummary = within(metrics).getByRole('article', { name: /reward summary/i });
    expect(within(rewardSummary).queryByText(/dreams bonus/i)).not.toBeInTheDocument();
  });

  it('shows a non-zero DREAMS estimate when its USDC equivalent rounds to zero', () => {
    render(
      <TaskDetailPanel
        modeData={{}}
        task={{
          ...taskDetail,
          estimatedWorkerUsdBonusValue: '0',
          estimatedWorkerDreamsBonus: (1n * 10n ** 18n).toString(),
        }}
      />
    );

    const metrics = screen.getByRole('region', { name: /task metrics/i });
    const bonusSummary = within(metrics).getByRole('article', {
      name: /estimated dreams bonus summary/i,
    });

    expect(within(bonusSummary).getByText('+1 DREAMS')).toBeInTheDocument();
    expect(within(bonusSummary).queryByText(/approximately/i)).not.toBeInTheDocument();
    expect(
      within(bonusSummary).getByRole('button', {
        name: /learn how dreams bonus eligibility works/i,
      })
    ).toBeInTheDocument();
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

    expect(screen.getByText(/review required/i)).toBeInTheDocument();
    expect(screen.getAllByText(/submission window closed/i).length).toBeGreaterThan(0);
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

  it('paginates and sorts a large submitter review queue', async () => {
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

    // 12 submitters at 10 per page -> 2 pages, showing 1-10 first. Scope the
    // article query to submission cards -- the reward/status DetailMetric
    // summaries are also <article>s and would otherwise inflate the count.
    expect(screen.getByText('Showing 1-10 of 12 submitters')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Showing 11-12 of 12 submitters')).toBeInTheDocument();
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

  it('collapses repeated submissions into one submitter and drills into inline history', async () => {
    const user = userEvent.setup();
    const workerAddress = '0x3333333333333333333333333333333333333333';
    const submissions: SubmissionResponse[] = Array.from({ length: 12 }, (_, index) => ({
      artifacts: [],
      fileUrl: `ipfs://deliverable-${index + 1}`,
      id: `sub-${index + 1}`,
      signature: '0xsig',
      submittedAt: new Date(Date.now() - (12 - index) * 60_000).toISOString(),
      taskId: task.id,
      workerAddress,
    }));

    renderReviewSubmissions(submissions);

    expect(screen.getByText('1 active submitter · 12 active submissions')).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(1);
    expect(
      screen.getByRole('group', {
        name: `Submitter ${compactAddressLabel(workerAddress)}, 12 submissions`,
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/page 1 of 2/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^View all 12 submissions from/ }));

    const historyHeading = await screen.findByRole('heading', { name: 'Submitter history' });
    expect(historyHeading).toHaveFocus();
    expect(screen.getByTestId('submitter-history')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Submission \d+ of 12 from/ })).toHaveLength(10);
    expect(screen.getByText('Showing 1-10 of 12 submissions')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to all submitters/i }));

    expect(screen.getByRole('heading', { name: /submission review/i })).toBeInTheDocument();
    expect(screen.queryByTestId('submitter-history')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /^Submission from/ })).toHaveLength(1);
  });

  it('keeps rejected submitter history accessible without review actions', async () => {
    const user = userEvent.setup();
    const workerAddress = '0x3333333333333333333333333333333333333333';

    renderReviewSubmissions([
      {
        artifacts: [],
        fileUrl: 'ipfs://deliverable-older',
        id: 'sub-older',
        signature: '0xsig',
        submittedAt: new Date(Date.now() - 120_000).toISOString(),
        taskId: task.id,
        workerAddress,
      },
      {
        artifacts: [],
        fileUrl: 'ipfs://deliverable-rejected',
        id: 'sub-rejected',
        rejectedAt: new Date(Date.now() - 60_000).toISOString(),
        signature: '0xsig',
        submittedAt: new Date(Date.now() - 60_000).toISOString(),
        taskId: task.id,
        workerAddress,
      },
    ]);

    expect(screen.getByText('No active submissions to review.')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /^Submission from/ })).not.toBeInTheDocument();

    await user.click(screen.getByText('Rejected submitters (1)'));
    expect(screen.getAllByText('2 submissions')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'View history' }));

    expect(await screen.findByRole('heading', { name: 'Submitter history' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Submission \d+ of 2 from/ })).toHaveLength(2);
    expect(screen.getAllByText(/^Rejected(?: with submitter)?$/)).toHaveLength(3);
    expect(screen.queryByRole('group', { name: 'Submitter decisions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Release payout')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject submitter/i })).not.toBeInTheDocument();
  });

  describe('benchmark secondary submissions review surface', () => {
    const workerA = '0x3333333333333333333333333333333333333333';
    const workerB = '0x4444444444444444444444444444444444444444';

    function benchmarkSubmission(id: string, worker: string): SubmissionResponse {
      return {
        artifacts: [],
        fileUrl: `ipfs://${id}`,
        id,
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: worker,
      };
    }

    function renderBenchmarkTask(options?: {
      submissions?: SubmissionResponse[];
      submissionCount?: number;
      asRequester?: boolean;
      omitReviewActions?: boolean;
    }) {
      if (options?.asRequester ?? true) {
        mockAccount.address = task.requester;
        mockAccount.isConnected = true;
      }
      const submissions = options?.submissions ?? [];
      return render(
        <TaskDetailPanel
          modeData={{ proofs: [], submissions }}
          task={{
            ...taskDetail,
            auctionBidCount: null,
            auctionType: null,
            mode: 'benchmark',
            pendingActions: options?.omitReviewActions
              ? []
              : [
                  {
                    action: 'accept',
                    command: `taskmarket task accept ${task.id} --worker ${workerA}`,
                    role: 'requester',
                  },
                  {
                    action: 'reject_submission',
                    command: `taskmarket task reject-submission ${task.id} --worker <address>`,
                    role: 'requester',
                  },
                ],
            status: 'open',
            submissionCount: options?.submissionCount ?? submissions.length,
          }}
        />
      );
    }

    it('renders no Additional submissions disclosure when submissionCount is 0', () => {
      renderBenchmarkTask({ submissionCount: 0, submissions: [] });

      expect(screen.queryByTestId('benchmark-submission-review')).not.toBeInTheDocument();
      expect(screen.queryByText(/additional submissions/i)).not.toBeInTheDocument();
    });

    it('renders no disclosure when the backend has not generated accept/reject pending actions', () => {
      renderBenchmarkTask({
        omitReviewActions: true,
        submissions: [benchmarkSubmission('sub-1', workerA)],
      });

      expect(screen.queryByTestId('benchmark-submission-review')).not.toBeInTheDocument();
    });

    it('renders the collapsed disclosure with the correct count for a benchmark task with submissions', () => {
      renderBenchmarkTask({
        submissions: [benchmarkSubmission('sub-1', workerA), benchmarkSubmission('sub-2', workerB)],
      });

      const disclosure = screen.getByTestId('benchmark-submission-review');
      expect(disclosure.tagName).toBe('DETAILS');
      expect(disclosure).not.toHaveAttribute('open');
      expect(screen.getByText('Additional submissions (2)')).toBeInTheDocument();
    });

    it('groups the secondary surface by worker using the same rules as the primary queue', async () => {
      const user = userEvent.setup();
      renderBenchmarkTask({
        submissions: [
          benchmarkSubmission('sub-1', workerA),
          benchmarkSubmission('sub-2', workerA),
          benchmarkSubmission('sub-3', workerB),
        ],
      });

      await user.click(screen.getByText('Additional submissions (3)'));

      expect(
        screen.getByTestId(`benchmark-submitter-group-${workerA.toLowerCase()}`)
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`benchmark-submitter-group-${workerB.toLowerCase()}`)
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^View all 2 submissions from/ }));
      expect(await screen.findByRole('heading', { name: 'Submitter history' })).toBeInTheDocument();
      expect(screen.getAllByRole('region', { name: /^Submission \d+ of 2 from/ })).toHaveLength(2);
    });

    it('wires accept/reject on the secondary surface with the same command shape as the primary queue', async () => {
      const user = userEvent.setup();
      renderBenchmarkTask({ submissions: [benchmarkSubmission('sub-1', workerA)] });

      await user.click(screen.getByText('Additional submissions (1)'));

      expect(screen.getAllByText('Release payout').length).toBeGreaterThan(0);
      expect(
        screen.getByText('Releases payout to this worker using their latest active submission.')
      ).toBeInTheDocument();

      const rejectButton = screen.getByRole('button', {
        name: 'Reject submitter and all 1 submission',
      });
      await user.click(rejectButton);

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Reject this submitter?')).toBeInTheDocument();
      expect(within(dialog).getByText(/0\.001 usdc/i)).toBeInTheDocument();
      expect(within(dialog).getByText(workerA, { exact: false })).toBeInTheDocument();
    });

    it('does not affect the primary proof feed when the secondary surface is opened, and vice versa', async () => {
      const user = userEvent.setup();
      render(
        <TaskDetailPanel
          modeData={{
            proofs: [
              {
                id: 'proof-1',
                metricValue: '0.9',
                proofData: 'ipfs://proof-data',
                proofType: 'eval',
                status: 'pending',
                submissionId: null,
                submittedAt: new Date().toISOString(),
                taskId: task.id,
                workerAddress: '0x5555555555555555555555555555555555555555',
              },
            ],
            submissions: [benchmarkSubmission('sub-1', workerA)],
          }}
          task={{
            ...taskDetail,
            auctionBidCount: null,
            auctionType: null,
            mode: 'benchmark',
            pendingActions: [
              {
                action: 'accept',
                command: `taskmarket task accept ${task.id} --worker ${workerA}`,
                role: 'requester',
              },
              {
                action: 'reject_submission',
                command: `taskmarket task reject-submission ${task.id} --worker <address>`,
                role: 'requester',
              },
            ],
            status: 'open',
            submissionCount: 1,
          }}
        />
      );

      expect(screen.getByText('eval')).toBeInTheDocument();

      await user.click(screen.getByText('Additional submissions (1)'));

      // Opening the secondary surface leaves the primary proof feed unchanged.
      expect(screen.getByText('eval')).toBeInTheDocument();
      expect(screen.getByTestId('benchmark-submission-review')).toBeInTheDocument();
    });

    it('renders a bounty task byte-identically whether or not this milestone is present', () => {
      renderReviewSubmissions([
        {
          artifacts: [],
          fileUrl: 'ipfs://deliverable',
          id: 'sub-1',
          signature: '0xsig',
          submittedAt: new Date().toISOString(),
          taskId: task.id,
          workerAddress: workerA,
        },
      ]);

      // The secondary surface is benchmark-only and additive; a bounty task's
      // grouped review queue must never render it.
      expect(screen.queryByTestId('benchmark-submission-review')).not.toBeInTheDocument();
      expect(screen.queryByText(/additional submissions/i)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /submission review/i })).toBeInTheDocument();
    });
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

  it('renders a genuinely empty submission as a single short line, not a min-h-72 file-count void', () => {
    renderReviewSubmissions([
      {
        artifacts: [],
        fileUrl: 'ipfs://deliverable',
        id: 'sub-a',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    const comparison = screen.getByRole('region', { name: /artifact comparison/i });
    const card = within(comparison).getByRole('article', { name: /submission from/i });

    expect(within(card).queryByText(/0 files/i)).not.toBeInTheDocument();
    expect(card.querySelector('.min-h-72')).not.toBeInTheDocument();
    expect(
      within(card).getByText(/no artifacts were attached to this submission/i)
    ).toBeInTheDocument();
  });

  it('renders an HTML-only submission as its hero surface instead of a collapsed supporting-files disclosure', () => {
    renderReviewSubmissions([
      {
        artifacts: [
          makeArtifact({
            fileName: 'game.html',
            id: 'artifact-html',
            mediaKind: 'text',
            mimeType: 'text/html',
          }),
        ],
        fileUrl: 'ipfs://deliverable',
        id: 'sub-a',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    const comparison = screen.getByRole('region', { name: /artifact comparison/i });
    expect(
      within(comparison).getByRole('button', { name: /open game\.html preview/i })
    ).toBeInTheDocument();
    expect(within(comparison).queryByText(/supporting files/i)).not.toBeInTheDocument();
  });

  it('renders the interactive HTML hero as a live sandboxed poster once in view, not a file-count fallback', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const htmlContent = '<html><body>game</body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);

    renderReviewSubmissions([
      {
        artifacts: [
          makeArtifact({
            fileName: 'game.html',
            id: 'artifact-html',
            mediaKind: 'text',
            mimeType: 'text/html',
            previewUrl: 'https://files.example.com/game.html',
          }),
        ],
        fileUrl: 'ipfs://deliverable',
        id: 'sub-a',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    const comparison = screen.getByRole('region', { name: /artifact comparison/i });
    expect(within(comparison).queryByText(/1 file/i)).not.toBeInTheDocument();

    FakeIntersectionObserver.instances.at(-1)?.trigger(true);

    const frame = await within(comparison).findByTitle('Interactive preview of game.html');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');

    fetchMock.mockRestore();
  });

  // Hero selection picks whichever playable artifact comes first in upload order
  // (displayOrder), not whichever type it is -- an HTML deliverable submitted ahead
  // of an image still becomes the hero, and the image is demoted to a thumbnail.
  it('picks the first playable artifact in upload order as hero over a later image, regardless of type', () => {
    renderReviewSubmissions([
      {
        artifacts: [
          makeArtifact({
            displayOrder: 0,
            fileName: 'demo.html',
            id: 'artifact-html-first',
            mediaKind: 'text',
            mimeType: 'text/html',
          }),
          makeArtifact({
            displayOrder: 1,
            fileName: 'screenshot.png',
            id: 'artifact-image-second',
            previewUrl: 'https://files.example.com/screenshot.png',
          }),
        ],
        fileUrl: 'ipfs://deliverable',
        id: 'sub-a',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    const comparison = screen.getByRole('region', { name: /artifact comparison/i });
    const heroButton = within(comparison).getByRole('button', {
      name: /open demo\.html preview/i,
    });
    const thumbButton = within(comparison).getByRole('button', {
      name: /open screenshot\.png preview/i,
    });

    // The hero surface and the small thumbnail surface use distinct sizing; the
    // thumbnail carries a fixed `size-16` class that the hero never does.
    expect(heroButton.className).not.toContain('size-16');
    expect(thumbButton.className).toContain('size-16');
  });

  it('lets reviewers switch the same submission queue between gallery and list views', async () => {
    const user = userEvent.setup();

    renderReviewSubmissions([
      {
        artifacts: [
          makeArtifact({
            fileName: 'candidate-a.png',
            id: 'artifact-image-a',
            previewUrl: 'https://files.example.com/candidate-a.png',
          }),
        ],
        fileUrl: 'ipfs://deliverable-a',
        id: 'sub-a',
        signature: '0xsig',
        submittedAt: new Date().toISOString(),
        taskId: task.id,
        workerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    const galleryButton = screen.getByRole('button', { name: /gallery view/i });
    const listButton = screen.getByRole('button', { name: /list view/i });

    expect(galleryButton).toHaveAttribute('aria-pressed', 'true');
    expect(listButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(listButton);

    expect(galleryButton).toHaveAttribute('aria-pressed', 'false');
    expect(listButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('article', {
        name: `Submission from ${compactAddressLabel('0x3333333333333333333333333333333333333333')}`,
      })
    ).toBeInTheDocument();
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

  it('lets disconnected viewers connect from the review summary', async () => {
    const user = userEvent.setup();
    mockAuth.authenticated = true;

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

    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    expect(within(sidebar).getByText(/connected as/i)).toHaveTextContent(/no wallet connected/i);
    expect(within(sidebar).getByText(/only requester/i)).toBeInTheDocument();
    expect(
      within(sidebar).getAllByText(
        compactAddressLabel('0x1111111111111111111111111111111111111111')
      )
    ).toHaveLength(2);
    await user.click(within(sidebar).getByRole('button', { name: /connect wallet/i }));
    expect(mockPrivyConnect).toHaveBeenCalled();
    expect(
      screen.queryByRole('group', { name: /payout release requirement/i })
    ).not.toBeInTheDocument();
  });

  it('lets a wrong connected wallet switch from the review summary', async () => {
    const user = userEvent.setup();
    mockAuth.authenticated = true;
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

    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    expect(within(sidebar).getByText(/connected as/i)).toBeInTheDocument();
    expect(
      within(sidebar).getByText(compactAddressLabel('0x9999999999999999999999999999999999999999'))
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: /payout release requirement/i })
    ).not.toBeInTheDocument();
    await user.click(within(sidebar).getByRole('button', { name: /switch wallet/i }));
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

  it('opens interactive HTML inside the artifact dialog without exposing the storage URL', async () => {
    const htmlContent =
      '<!doctype html><html><body><output id="result">4</output><script>document.body.dataset.ready = "true";</script></body></html>';
    const presignedUrl = 'https://files.example.com/calculator.html';
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
      return { ok: true, text: async () => htmlContent } as Response;
    });
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'calculator.html',
        id: 'artifact-html',
        mediaKind: 'text',
        mimeType: 'text/html; charset=utf-8',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /open calculator\.html preview/i }));

    const dialog = await screen.findByRole('dialog');
    const frame = await within(dialog).findByTitle('Interactive preview of calculator.html');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('allow', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).not.toHaveAttribute('src');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
    expect(frame.getAttribute('srcdoc')).toContain('document.body.dataset.ready');
    expect(
      within(dialog).getByText(/untrusted interactive html.*do not enter passwords/i)
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /open artifact/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      presignedUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(screen.queryByTitle('Interactive preview of calculator.html')).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('does not fetch an HTML artifact body over the 5 MiB preview limit', async () => {
    const presignedUrl = 'https://files.example.com/oversized.html';
    const fetchMock = mockPreviewFetch(presignedUrl);
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'oversized.html',
        id: 'artifact-html-oversized',
        mediaKind: 'unknown',
        mimeType: 'application/octet-stream',
        sizeBytes: 5_242_881,
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /open oversized\.html preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/exceeds the 5 mb interactive preview limit/i)
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(presignedUrl, expect.anything());

    fetchMock.mockRestore();
  });

  it('does not render an HTML body that exceeds the limit despite smaller metadata', async () => {
    const presignedUrl = 'https://files.example.com/mismatched-size.html';
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
      return {
        ok: true,
        text: async () => 'x'.repeat(MAX_INTERACTIVE_HTML_BYTES + 1),
      } as Response;
    });
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'mismatched-size.html',
        id: 'artifact-html-mismatched-size',
        mediaKind: 'text',
        mimeType: 'text/html',
        sizeBytes: 1024,
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /open mismatched-size\.html preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/exceeds the 5 mb interactive preview limit/i)
    ).toBeInTheDocument();
    expect(within(dialog).queryByTitle(/interactive preview/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockRestore();
  });

  it('retries a failed HTML body fetch inside the dialog', async () => {
    const presignedUrl = 'https://files.example.com/retry.html';
    let bodyAttempts = 0;
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

      bodyAttempts += 1;
      if (bodyAttempts === 1) {
        return { ok: false, status: 503 } as Response;
      }
      return {
        ok: true,
        text: async () => '<html><body>Recovered calculator</body></html>',
      } as Response;
    });
    const user = userEvent.setup();

    renderBountyArtifacts([
      makeArtifact({
        fileName: 'retry.html',
        id: 'artifact-html-retry',
        mediaKind: 'text',
        mimeType: 'text/html',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /open retry\.html preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/failed to load html preview.*503/i)
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^retry$/i }));
    expect(
      await within(dialog).findByTitle('Interactive preview of retry.html')
    ).toBeInTheDocument();
    expect(bodyAttempts).toBe(2);

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
        modeData={{ bids: [] }}
        task={{
          ...taskDetail,
          pendingActions: [
            {
              action: 'update',
              command: `taskmarket task update ${task.id} --reward 25000000 --extend-expiry 86400 --receipt 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`,
              role: 'requester',
            },
          ],
        }}
      />
    );

    const cliCommand = screen.getByText(/taskmarket task update/i);
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
    expect(screen.getByText(/escrow tx/i)).toBeInTheDocument();
    expect(screen.getByText(/created/i)).toBeInTheDocument();
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

    expect(screen.getByText('Requester')).toBeInTheDocument();
    expect(screen.queryByText(compactAddressLabel(task.requester))).not.toBeInTheDocument();
    const requesterLink = screen.getByRole('link', { name: getAgentName('42') ?? 'Agent #42' });
    expect(requesterLink).toHaveAttribute('href', '/dashboard/agents/42');
  });

  it('falls back to the requester wallet when there is no registered agent id', () => {
    render(<TaskDetailPanel modeData={{ bids: [] }} task={taskDetail} />);

    expect(screen.getByText('Requester')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: compactAddressLabel(task.requester) })
    ).toBeInTheDocument();
  });

  it('shows an expired due state for an open task past its expiry', () => {
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

    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
    expect(screen.getByText('Expired - no submissions')).toBeInTheDocument();
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
  });
});
