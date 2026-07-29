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

function submission(
  id: string,
  worker: string,
  artifacts: ArtifactResponse[],
  submittedAt = '2026-01-02T00:00:00.000Z'
): SubmissionResponse {
  return {
    artifacts,
    fileUrl: `ipfs://${id}`,
    id,
    signature: '0xsig',
    submittedAt,
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

// LiveActivityPanel sorts submissions newest-first. Fixed, distinct timestamps
// keep the gallery order deterministic instead of depending on millisecond timing.
const submissions = [
  submission('sub-1', '0x3333333333333333333333333333333333333333', [imageA, notesA]),
  submission(
    'sub-2',
    '0x4444444444444444444444444444444444444444',
    [imageB, videoC],
    '2026-01-01T00:00:00.000Z'
  ),
];

function panel(initialSubmissions: SubmissionResponse[]) {
  return (
    <LiveActivityPanel
      initialModeData={{ submissions: initialSubmissions }}
      profileBasePath="/dashboard/agents"
      task={task}
    />
  );
}

function renderPanel(initialSubmissions: SubmissionResponse[] = submissions) {
  return render(panel(initialSubmissions));
}

// The feed re-signs every preview URL on each poll, so the same artifact arrives with
// a new query string. Simulates that by re-issuing the submissions with fresh URLs.
function resign(list: SubmissionResponse[], token: string): SubmissionResponse[] {
  return list.map((entry) => ({
    ...entry,
    artifacts: (entry.artifacts ?? []).map((item) =>
      item.previewUrl ? { ...item, previewUrl: `${item.previewUrl}?sig=${token}` } : { ...item }
    ),
  }));
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
    expect(within(dialog).getByAltText('poster-a.png')).toHaveClass(
      'min-h-0',
      'h-full',
      'w-full',
      'object-contain'
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

  it('keeps the open video playing when a poll re-signs its preview URL', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();

    await user.click(screen.getByRole('button', { name: /open walkthrough\.mp4 preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/walkthrough.mp4'
    );

    rerender(panel(resign(submissions, 'poll-2')));

    // A new src would make the browser drop the loaded media and restart playback.
    expect(screen.getByRole('dialog').querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/walkthrough.mp4'
    );
  });

  it('stays on the open artifact when a newer submission joins the feed', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();

    await user.click(screen.getByRole('button', { name: /open walkthrough\.mp4 preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();

    const newer = submission(
      'sub-3',
      '0x5555555555555555555555555555555555555555',
      [
        artifact({
          fileName: 'late.png',
          id: 'artifact-late',
          previewUrl: 'https://files.example.com/late.png',
          submissionId: 'sub-3',
        }),
      ],
      '2026-03-01T00:00:00.000Z'
    );
    rerender(panel([newer, ...submissions]));

    // The newer submission shifts every entry down one slot; the gallery follows the
    // artifact that was opened rather than its old position.
    const refreshed = screen.getByRole('dialog');
    expect(refreshed.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/walkthrough.mp4'
    );
    expect(within(refreshed).getByText('4 / 4')).toBeInTheDocument();
  });

  it('keeps an inline hero video src stable when a poll re-signs it', () => {
    const heroVideo = artifact({
      fileName: 'hero.mp4',
      id: 'artifact-hero',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/hero.mp4',
      submissionId: 'sub-3',
    });
    const videoOnly = [
      submission('sub-3', '0x5555555555555555555555555555555555555555', [heroVideo]),
    ];
    const { rerender } = render(panel(videoOnly));

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/hero.mp4'
    );

    rerender(panel(resign(videoOnly, 'poll-2')));

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/hero.mp4'
    );
  });

  it('hides the gallery button when no submission carries media artifacts', () => {
    renderPanel([submission('sub-1', '0x3333333333333333333333333333333333333333', [notesA])]);

    expect(screen.queryByRole('button', { name: /gallery/i })).not.toBeInTheDocument();
  });
});
