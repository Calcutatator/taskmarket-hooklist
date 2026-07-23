import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResponse, SubmissionResponse, TaskDetailResponse } from '@taskmarket/shared';

import { LiveActivityPanel } from './live-activity';
import { submissionMediaEntries } from './submission-gallery';

const { mockAccount } = vi.hoisted(() => ({
  mockAccount: { address: undefined as string | undefined },
}));

function stubQuery(_input: unknown, options?: { initialData?: unknown }) {
  return { data: options?.initialData };
}

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

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  motion: {
    div: ({
      animate: _animate,
      initial: _initial,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => <div {...props} />,
  },
  useReducedMotion: () => true,
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

afterEach(() => {
  mockAccount.address = undefined;
});

const task: TaskDetailResponse = {
  auctionBidCount: null,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: new Date().toISOString(),
  currentLowestBid: null,
  description: 'Bounty task',
  escrowTxHash: '0xhash',
  expiryTime: new Date(Date.now() + 86_400_000).toISOString(),
  id: 'task-1',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  pendingActions: [],
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester: '0x1111111111111111111111111111111111111111',
  requesterPubkey: '0x1111111111111111111111111111111111111111',
  reward: '25000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'pending_approval',
  submissionCount: 2,
  submissionVisibility: 'public',
  submissionWindowOpen: false,
  phase: 'active',
  tags: ['design'],
  taskVisibility: 'public',
};

function artifact(overrides: Partial<ArtifactResponse>): ArtifactResponse {
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

function submission(id: string, worker: string, artifacts: ArtifactResponse[]): SubmissionResponse {
  return {
    artifacts,
    fileUrl: `ipfs://${id}`,
    id,
    signature: '0xsig',
    submittedAt: new Date().toISOString(),
    taskId: task.id,
    workerAddress: worker,
  };
}

const imageA = artifact({
  fileName: 'poster-a.png',
  id: 'artifact-a',
  previewUrl: 'https://files.example.com/poster-a.png',
});
const notesA = artifact({
  fileName: 'notes.md',
  id: 'artifact-notes',
  mediaKind: 'text',
  mimeType: 'text/markdown',
  role: 'source',
});
const imageB = artifact({
  fileName: 'poster-b.png',
  id: 'artifact-b',
  previewUrl: 'https://files.example.com/poster-b.png',
  submissionId: 'sub-2',
});
const videoC = artifact({
  fileName: 'walkthrough.mp4',
  id: 'artifact-c',
  mediaKind: 'video',
  mimeType: 'video/mp4',
  previewUrl: 'https://files.example.com/walkthrough.mp4',
  submissionId: 'sub-2',
});

const submissions = [
  submission('sub-1', '0x3333333333333333333333333333333333333333', [imageA, notesA]),
  submission('sub-2', '0x4444444444444444444444444444444444444444', [imageB, videoC]),
];

function renderPanel(initialSubmissions: SubmissionResponse[] = submissions) {
  return render(
    <LiveActivityPanel
      initialModeData={{ submissions: initialSubmissions }}
      profileBasePath="/dashboard/agents"
      task={task}
    />
  );
}

describe('submissionMediaEntries', () => {
  it('flattens media artifacts across submissions in feed order and skips text files', () => {
    const entries = submissionMediaEntries(submissions);

    expect(entries.map((entry) => entry.artifact.id)).toEqual([
      'artifact-a',
      'artifact-b',
      'artifact-c',
    ]);
    expect(entries[1]?.submission.id).toBe('sub-2');
  });
});

describe('SubmissionGalleryDialog', () => {
  it('opens the gallery from the header button at the first media artifact', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('poster-a.png')).toHaveAttribute(
      'src',
      'https://files.example.com/poster-a.png'
    );
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('opens at the clicked artifact and navigates with wrap-around, including video', async () => {
    const user = userEvent.setup();
    renderPanel();

    // The second submission's hero opens the gallery at that artifact.
    await user.click(screen.getByRole('button', { name: /open poster-b\.png preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('poster-b.png')).toBeInTheDocument();
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /next submission/i }));
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    expect(dialog.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/walkthrough.mp4'
    );

    // Wraps from the last entry back to the first.
    await user.click(within(dialog).getByRole('button', { name: /next submission/i }));
    expect(within(dialog).getByAltText('poster-a.png')).toBeInTheDocument();
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();

    // Arrow keys navigate too, wrapping backwards from the first entry.
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('hides the gallery button when no submission carries media artifacts', () => {
    renderPanel([submission('sub-1', '0x3333333333333333333333333333333333333333', [notesA])]);

    expect(screen.queryByRole('button', { name: /gallery/i })).not.toBeInTheDocument();
  });
});
