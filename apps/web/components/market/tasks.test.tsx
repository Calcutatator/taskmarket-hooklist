import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResponse, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { CreateTaskPanel, TaskDetailPanel, TaskFilterRail, TaskTable } from './tasks';
import { getAcceptWorkerAddress } from './actions/accept-button';

const { mockAccount, mockConnect, mockDisconnect } = vi.hoisted(() => ({
  mockAccount: {
    address: undefined as string | undefined,
    isConnected: false,
  },
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useConnect: () => ({
    connect: mockConnect,
    connectors: [{ id: 'injected', name: 'Injected' }],
  }),
  useDisconnect: () => ({ disconnect: mockDisconnect }),
}));

afterEach(() => {
  mockAccount.address = undefined;
  mockAccount.isConnected = false;
  mockConnect.mockClear();
  mockDisconnect.mockClear();
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
  return render(
    <TaskDetailPanel
      modeData={{
        submissions: [
          {
            artifacts,
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
        pendingActions: [],
        status: 'pending_approval',
        submissionCount: 1,
      }}
    />
  );
}

function mockPreviewFetch(previewUrl: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: async () => ({ expiresAt: '2026-05-12T08:00:00.000Z', previewUrl }),
    ok: true,
  } as Response);
}

describe('Task marketplace components', () => {
  it('renders populated, empty, loading, and error task table states', () => {
    const { rerender } = render(<TaskTable tasks={[task]} />);
    const taskLinks = screen.getAllByRole('link', { name: /summarize protocol feedback/i });
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
    expect(taskLinks.at(0)).toHaveAttribute('href', '/dashboard/tasks/0xabc123');
    expect(screen.getByRole('list', { name: /task cards/i })).toBeInTheDocument();
    expect(screen.getAllByText(/requester/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('+25.000 USDC').length).toBeGreaterThan(0);

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
    expect(within(rewardSummary).getByText('+25.000 USDC')).toBeInTheDocument();
    expect(within(rewardSummary).getByText(/^due$/i)).toBeInTheDocument();
    const activitySummary = within(metrics).getByRole('article', { name: /bids summary/i });
    expect(within(activitySummary).getByText(/^bids$/i)).toBeInTheDocument();
    expect(within(activitySummary).getByText('2 bids')).toBeInTheDocument();
    expect(metrics.closest('[data-slot="card"]')).toBeNull();
    const referenceCard = screen.getByText(/task reference/i).closest('[data-slot="card"]');
    expect(referenceCard).not.toBeNull();
    const reference = within(referenceCard as HTMLElement);
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
    expect(screen.getAllByText('+12.000 USDC').length).toBeGreaterThan(0);
    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/worker actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/who can run/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^result$/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/requester actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/worker actions/i)).not.toBeInTheDocument();
    expect(screen.getByText(`taskmarket task submit ${task.id} --file <path>`)).toBeInTheDocument();
    expect(screen.queryByText(/^CLI$/i)).not.toBeInTheDocument();
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
    const sidebar = screen.getByRole('complementary', { name: /task sidebar/i });
    expect(within(sidebar).getByRole('button', { name: /^cancel task$/i })).toBeInTheDocument();
    expect(within(sidebar).queryByLabelText(/reward \(usdc\)/i)).not.toBeInTheDocument();
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
    expect(screen.getByText(/deliverable submitted by/i)).toBeInTheDocument();
    expect(screen.getAllByText(/release payout/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/review the latest submission/i)).not.toBeInTheDocument();
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

    expect(screen.getByText(/connect requester wallet to release payout/i)).toBeInTheDocument();
    expect(screen.getByText(/required requester/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeEnabled();
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

    expect(screen.getByText(/requester wallet required/i)).toBeInTheDocument();
    expect(screen.getByText(/connected wallet/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /switch wallet/i }));

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('previews image artifacts inline without opening a new window', async () => {
    const previewUrl = 'https://files.example.com/logo.png';
    const fetchMock = mockPreviewFetch(previewUrl);
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();

    renderBountyArtifacts([makeArtifact({ fileName: 'logo.png', id: 'artifact-image' })]);

    await user.click(screen.getByRole('button', { name: /^view$/i }));

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
          json: async () => ({ expiresAt: '2026-05-12T08:00:00.000Z', previewUrl: presignedUrl }),
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
          worker: null,
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
          rating: null,
          status: 'completed',
          worker: '0x3333333333333333333333333333333333333333',
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
    expect(screen.getAllByText('+25.000 USDC').length).toBeGreaterThan(0);
  });
});
