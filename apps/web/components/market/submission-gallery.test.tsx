import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResponse, SubmissionResponse, TaskDetailResponse } from '@taskmarket/shared';
import { createContext, useContext, type ReactNode } from 'react';

import { LiveActivityPanel } from './live-activity';
import {
  SubmissionGalleryDialog,
  submissionMediaEntries,
  type SubmissionMediaEntry,
} from './submission-gallery';
import { INTERACTIVE_HTML_ESCAPE_MESSAGE, MAX_INTERACTIVE_HTML_BYTES } from '@/lib/sandboxed-html';

// vaul drives its bottom-sheet drag gesture off Pointer Events + CSS transform APIs
// that jsdom does not implement, so mounting a real vaul Drawer throws. Mirrors the
// mock already used in artifact-preview-button.test.tsx for the same class of
// animation-library/jsdom mismatch, so the drawer's own structure (rendered by
// components/ui/drawer.tsx) is still exercised for real.
const mockDrawerOpenContext = createContext(false);

vi.mock('vaul', () => {
  function Root({ children, open }: { children: ReactNode; open?: boolean }) {
    return (
      <mockDrawerOpenContext.Provider value={!!open}>{children}</mockDrawerOpenContext.Provider>
    );
  }
  function Trigger(props: Record<string, unknown>) {
    return <button type="button" {...props} />;
  }
  function Portal({ children }: { children: ReactNode }) {
    const open = useContext(mockDrawerOpenContext);
    return open ? children : null;
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

function setupMatchMedia(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: width < 768,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

class ImmediateIntersectionObserverStub {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(target: Element) {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this as unknown as IntersectionObserver
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

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

vi.mock('wagmi', () => ({
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
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
  vi.unstubAllGlobals();
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
const gameHtml = artifact({
  fileName: 'game.html',
  id: 'artifact-html',
  mediaKind: 'text',
  mimeType: 'text/html',
  previewUrl: 'https://files.example.com/game.html',
  submissionId: 'sub-html',
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

function galleryEntry(
  artifactValue: ArtifactResponse,
  submissionValue: SubmissionResponse
): SubmissionMediaEntry {
  return { artifact: artifactValue, submission: submissionValue };
}

function directGallery({
  contextLabel,
  entries,
  entryPolicy,
  initialArtifactId = entries[0]?.artifact.id ?? null,
  onOpenChange = vi.fn(),
  open = true,
  sessionKey,
}: {
  contextLabel?: string;
  entries: SubmissionMediaEntry[];
  entryPolicy?: 'live' | 'snapshot-membership';
  initialArtifactId?: string | null;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  sessionKey?: string;
}) {
  return (
    <SubmissionGalleryDialog
      contextLabel={contextLabel}
      entries={entries}
      entryPolicy={entryPolicy}
      initialArtifactId={initialArtifactId}
      onOpenChange={onOpenChange}
      open={open}
      profileBasePath="/dashboard/agents"
      sessionKey={sessionKey}
      taskId={task.id}
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

  it('includes interactive HTML artifacts alongside image and video artifacts', () => {
    const withHtml = [
      ...submissions,
      submission(
        'sub-html',
        '0x6666666666666666666666666666666666666666',
        [gameHtml],
        '2026-01-03T00:00:00.000Z'
      ),
    ];

    const entries = submissionMediaEntries(withHtml);

    expect(entries.map((entry) => entry.artifact.id)).toEqual([
      'artifact-a',
      'artifact-b',
      'artifact-c',
      'artifact-html',
    ]);
  });
});

describe('SubmissionGalleryDialog', () => {
  it('keeps live membership as the default when an open artifact disappears', async () => {
    setupMatchMedia(1280);
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);
    const secondSubmission = submission('sub-2', '0x4444444444444444444444444444444444444444', [
      imageB,
    ]);
    const firstEntry = galleryEntry(imageA, firstSubmission);
    const secondEntry = galleryEntry(imageB, secondSubmission);
    const { rerender } = render(
      directGallery({
        entries: [firstEntry, secondEntry],
        initialArtifactId: imageB.id,
      })
    );

    expect(
      within(await screen.findByRole('dialog')).getByAltText('poster-b.png')
    ).toBeInTheDocument();

    rerender(directGallery({ entries: [firstEntry], initialArtifactId: imageB.id }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByAltText('poster-a.png')).toBeInTheDocument();
    expect(within(dialog).getByText('1 / 1')).toBeInTheDocument();
  });

  it('retains captured membership and selection when snapshot entries disappear', async () => {
    setupMatchMedia(1280);
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);
    const secondSubmission = submission('sub-2', '0x4444444444444444444444444444444444444444', [
      imageB,
    ]);
    const firstEntry = galleryEntry(imageA, firstSubmission);
    const secondEntry = galleryEntry(imageB, secondSubmission);
    const { rerender } = render(
      directGallery({
        entries: [firstEntry, secondEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageB.id,
      })
    );

    expect(
      within(await screen.findByRole('dialog')).getByAltText('poster-b.png')
    ).toBeInTheDocument();

    rerender(
      directGallery({
        entries: [firstEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageB.id,
      })
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByAltText('poster-b.png')).toBeInTheDocument();
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
  });

  it('keeps captured order and ignores inserted entries during a snapshot session', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);
    const secondSubmission = submission('sub-2', '0x4444444444444444444444444444444444444444', [
      imageB,
    ]);
    const lateArtifact = artifact({
      fileName: 'late.png',
      id: 'artifact-late',
      previewUrl: 'https://files.example.com/late.png',
      submissionId: 'sub-late',
    });
    const lateSubmission = submission('sub-late', '0x5555555555555555555555555555555555555555', [
      lateArtifact,
    ]);
    const firstEntry = galleryEntry(imageA, firstSubmission);
    const secondEntry = galleryEntry(imageB, secondSubmission);
    const lateEntry = galleryEntry(lateArtifact, lateSubmission);
    const { rerender } = render(
      directGallery({
        entries: [firstEntry, secondEntry],
        entryPolicy: 'snapshot-membership',
      })
    );

    expect(within(await screen.findByRole('dialog')).getByText('1 / 2')).toBeInTheDocument();

    rerender(
      directGallery({
        entries: [lateEntry, firstEntry, secondEntry],
        entryPolicy: 'snapshot-membership',
      })
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();
    expect(within(dialog).queryByAltText('late.png')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Next artifact' }));
    expect(within(dialog).getByAltText('poster-b.png')).toBeInTheDocument();
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
  });

  it('refreshes metadata for captured entries that remain in the current scope', async () => {
    setupMatchMedia(1280);
    const secondSubmission = submission('sub-2', '0x4444444444444444444444444444444444444444', [
      imageB,
    ]);
    const originalEntry = galleryEntry(imageB, secondSubmission);
    const { rerender } = render(
      directGallery({
        entries: [originalEntry],
        entryPolicy: 'snapshot-membership',
      })
    );

    expect(
      within(await screen.findByRole('dialog')).getByRole('heading', { name: 'poster-b.png' })
    ).toBeInTheDocument();

    const refreshedArtifact = { ...imageB, fileName: 'poster-b-refreshed.png' };
    rerender(
      directGallery({
        entries: [
          galleryEntry(refreshedArtifact, {
            ...secondSubmission,
            artifacts: [refreshedArtifact],
          }),
        ],
        entryPolicy: 'snapshot-membership',
      })
    );

    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: 'poster-b-refreshed.png',
      })
    ).toBeInTheDocument();
  });

  it('captures the latest membership after a snapshot session closes and reopens', async () => {
    setupMatchMedia(1280);
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);
    const secondSubmission = submission('sub-2', '0x4444444444444444444444444444444444444444', [
      imageB,
    ]);
    const firstEntry = galleryEntry(imageA, firstSubmission);
    const secondEntry = galleryEntry(imageB, secondSubmission);
    const { rerender } = render(
      directGallery({
        entries: [firstEntry, secondEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageB.id,
      })
    );

    expect(within(await screen.findByRole('dialog')).getByText('2 / 2')).toBeInTheDocument();

    rerender(
      directGallery({
        entries: [firstEntry],
        entryPolicy: 'snapshot-membership',
        open: false,
      })
    );
    rerender(
      directGallery({
        entries: [firstEntry],
        entryPolicy: 'snapshot-membership',
        open: true,
      })
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('poster-a.png')).toBeInTheDocument();
    expect(within(dialog).getByText('1 / 1')).toBeInTheDocument();
    expect(within(dialog).queryByAltText('poster-b.png')).not.toBeInTheDocument();
  });

  it('closes and drops captured fallback entries when the authorization scope changes', async () => {
    setupMatchMedia(1280);
    const onOpenChange = vi.fn();
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);
    const secondSubmission = submission('sub-2', '0x4444444444444444444444444444444444444444', [
      imageB,
    ]);
    const firstEntry = galleryEntry(imageA, firstSubmission);
    const secondEntry = galleryEntry(imageB, secondSubmission);
    const { rerender } = render(
      directGallery({
        entries: [secondEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageB.id,
        onOpenChange,
        sessionKey: 'task-1:private:0xrequester',
      })
    );

    expect(
      within(await screen.findByRole('dialog')).getByAltText('poster-b.png')
    ).toBeInTheDocument();

    rerender(
      directGallery({
        entries: [firstEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageA.id,
        onOpenChange,
        sessionKey: 'task-1:private:0xother-account',
      })
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    rerender(
      directGallery({
        entries: [firstEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageA.id,
        onOpenChange,
        open: false,
        sessionKey: 'task-1:private:0xother-account',
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByAltText('poster-b.png')).not.toBeInTheDocument();

    rerender(
      directGallery({
        entries: [firstEntry],
        entryPolicy: 'snapshot-membership',
        initialArtifactId: imageA.id,
        onOpenChange,
        sessionKey: 'task-1:private:0xother-account',
      })
    );
    expect(
      within(await screen.findByRole('dialog')).getByAltText('poster-a.png')
    ).toBeInTheDocument();
    expect(screen.queryByAltText('poster-b.png')).not.toBeInTheDocument();
  });

  it('shows an optional context label in the desktop viewer header', async () => {
    setupMatchMedia(1280);
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);

    render(
      directGallery({
        contextLabel: 'Rejected submission history',
        entries: [galleryEntry(imageA, firstSubmission)],
      })
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rejected submission history')).toBeVisible();
  });

  it('expands the desktop gallery to the app viewport and restores its bounded layout', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);

    render(directGallery({ entries: [galleryEntry(imageA, firstSubmission)] }));

    const dialog = await screen.findByRole('dialog');
    const frame = within(dialog).getByTestId('gallery-frame');
    expect(dialog).toHaveAttribute('data-full-viewport', 'false');
    expect(dialog).toHaveClass('max-h-[92vh]', 'max-w-6xl', 'overflow-auto');
    expect(frame).toHaveClass('h-[62vh]');

    await user.click(within(dialog).getByRole('button', { name: 'Enter full screen' }));

    expect(dialog).toHaveAttribute('data-full-viewport', 'true');
    expect(dialog).toHaveClass(
      '!left-0',
      '!top-0',
      'h-app-viewport',
      '!w-screen',
      '!max-h-none',
      '!max-w-none',
      'grid-rows-[auto_minmax(0,1fr)_auto]',
      'overflow-hidden',
      'rounded-none',
      'border-0'
    );
    expect(frame).toHaveClass('h-full');
    expect(frame).not.toHaveClass('h-[62vh]');
    expect(within(dialog).getByRole('button', { name: 'Exit full screen' })).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Exit full screen' }));

    expect(dialog).toHaveAttribute('data-full-viewport', 'false');
    expect(frame).toHaveClass('h-[62vh]');
    expect(frame).not.toHaveClass('h-full');
    expect(within(dialog).getByRole('button', { name: 'Enter full screen' })).toBeVisible();
  });

  it('uses Escape to restore the bounded gallery before allowing the dialog to close', async () => {
    setupMatchMedia(1280);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);

    render(
      directGallery({
        entries: [galleryEntry(imageA, firstSubmission)],
        onOpenChange,
      })
    );

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enter full screen' }));

    await user.keyboard('{Escape}');

    expect(dialog).toHaveAttribute('data-full-viewport', 'false');
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resets full-viewport state when a controlled gallery closes', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);
    const entry = galleryEntry(imageA, firstSubmission);
    const { rerender } = render(directGallery({ entries: [entry] }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enter full screen' }));
    expect(dialog).toHaveAttribute('data-full-viewport', 'true');

    rerender(directGallery({ entries: [entry], open: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(directGallery({ entries: [entry] }));
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-full-viewport', 'false');
    expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeVisible();
  });

  it('names chevron navigation for artifacts', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Previous artifact' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next artifact' })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /previous submission/i })
    ).not.toBeInTheDocument();
  });

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

    await user.click(within(dialog).getByRole('button', { name: /next artifact/i }));
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    expect(dialog.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/walkthrough.mp4'
    );

    // Wraps from the last entry back to the first.
    await user.click(within(dialog).getByRole('button', { name: /next artifact/i }));
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

  it('pauses the current video when navigating away and when closing the gallery', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    const firstVideo = artifact({
      fileName: 'first.mp4',
      id: 'artifact-video-first',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/first.mp4',
      submissionId: 'sub-video-first',
    });
    const secondVideo = artifact({
      fileName: 'second.mp4',
      id: 'artifact-video-second',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/second.mp4',
      submissionId: 'sub-video-second',
    });
    const firstEntry = galleryEntry(
      firstVideo,
      submission('sub-video-first', '0x3333333333333333333333333333333333333333', [firstVideo])
    );
    const secondEntry = galleryEntry(
      secondVideo,
      submission('sub-video-second', '0x4444444444444444444444444444444444444444', [secondVideo])
    );
    const { rerender } = render(directGallery({ entries: [firstEntry, secondEntry] }));

    const dialog = await screen.findByRole('dialog');
    const firstPlayer = dialog.querySelector(
      'video[src="https://files.example.com/first.mp4"]'
    ) as HTMLVideoElement;
    let firstPaused = false;
    Object.defineProperty(firstPlayer, 'paused', {
      configurable: true,
      get: () => firstPaused,
    });
    vi.spyOn(firstPlayer, 'pause').mockImplementation(() => {
      firstPaused = true;
    });

    await user.click(within(dialog).getByRole('button', { name: 'Next artifact' }));
    expect(firstPlayer.paused).toBe(true);

    const secondPlayer = dialog.querySelector(
      'video[src="https://files.example.com/second.mp4"]'
    ) as HTMLVideoElement;
    let secondPaused = false;
    Object.defineProperty(secondPlayer, 'paused', {
      configurable: true,
      get: () => secondPaused,
    });
    vi.spyOn(secondPlayer, 'pause').mockImplementation(() => {
      secondPaused = true;
    });

    rerender(directGallery({ entries: [firstEntry, secondEntry], open: false }));
    expect(secondPlayer.paused).toBe(true);
  });

  it('keeps inactive slides inert and leaves interactive descendant arrow keys untouched', async () => {
    setupMatchMedia(1280);
    const firstVideo = artifact({
      fileName: 'first.mp4',
      id: 'artifact-video-first',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/first.mp4',
      submissionId: 'sub-video-first',
    });
    const secondVideo = artifact({
      fileName: 'second.mp4',
      id: 'artifact-video-second',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/second.mp4',
      submissionId: 'sub-video-second',
    });
    const firstEntry = galleryEntry(
      firstVideo,
      submission('sub-video-first', '0x3333333333333333333333333333333333333333', [firstVideo])
    );
    const secondEntry = galleryEntry(
      secondVideo,
      submission('sub-video-second', '0x4444444444444444444444444444444444444444', [secondVideo])
    );
    render(directGallery({ entries: [firstEntry, secondEntry] }));

    const dialog = await screen.findByRole('dialog');
    const firstPlayer = dialog.querySelector(
      'video[src="https://files.example.com/first.mp4"]'
    ) as HTMLVideoElement;
    const secondPlayer = dialog.querySelector(
      'video[src="https://files.example.com/second.mp4"]'
    ) as HTMLVideoElement;
    const inactivePane = secondPlayer.closest('[aria-hidden="true"]');

    expect(inactivePane).toHaveAttribute('inert');
    expect(firstPlayer.closest('[aria-hidden="true"]')).toBeNull();

    expect(fireEvent.keyDown(firstPlayer, { key: 'ArrowRight' })).toBe(true);
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();

    const details = within(dialog).getByText('Details');
    expect(fireEvent.keyDown(details, { key: 'ArrowLeft' })).toBe(true);
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();
  });

  it('mirrors a recovered video URL into the current artifact Details action', async () => {
    setupMatchMedia(1280);
    const freshUrl = 'https://files.example.com/walkthrough.mp4?sig=recovered';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        previewUrl: freshUrl,
      }),
      ok: true,
    } as Response);
    const user = userEvent.setup();
    const videoSubmission = submission('sub-video', '0x4444444444444444444444444444444444444444', [
      videoC,
    ]);
    render(
      directGallery({
        entries: [galleryEntry(videoC, videoSubmission)],
        initialArtifactId: videoC.id,
      })
    );

    const dialog = await screen.findByRole('dialog');
    const video = dialog.querySelector('video') as HTMLVideoElement;
    fireEvent.error(video);

    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    await user.click(within(dialog).getByText('Details'));

    expect(within(dialog).getByRole('link', { name: 'Open artifact' })).toHaveAttribute(
      'href',
      freshUrl
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps the video carousel window bounded to the current and adjacent artifacts', async () => {
    setupMatchMedia(1280);
    const videoEntries = Array.from({ length: 50 }, (_, index) => {
      const item = artifact({
        fileName: `video-${index}.mp4`,
        id: `artifact-video-${index}`,
        mediaKind: 'video',
        mimeType: 'video/mp4',
        previewUrl: `https://files.example.com/video-${index}.mp4`,
        submissionId: `sub-video-${index}`,
      });
      const itemSubmission = submission(
        `sub-video-${index}`,
        '0x4444444444444444444444444444444444444444',
        [item]
      );
      return galleryEntry(item, itemSubmission);
    });

    render(directGallery({ entries: videoEntries }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelectorAll('video')).toHaveLength(3);
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
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserverStub);
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

  it('renders an interactive HTML artifact in a sandboxed iframe with the untrusted-HTML warning', async () => {
    const htmlContent = '<html><body><output>4</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const user = userEvent.setup();

    renderPanel([submission('sub-html', '0x7777777777777777777777777777777777777777', [gameHtml])]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const frame = await within(dialog).findByTitle('Interactive preview of game.html');
    await user.click(within(dialog).getByRole('button', { name: 'Enter full screen' }));

    expect(dialog).toHaveAttribute('data-full-viewport', 'true');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('allow', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).not.toHaveAttribute('src');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
    expect(frame.getAttribute('srcdoc')).toContain('<output>4</output>');
    expect(
      within(dialog).getByText(/untrusted interactive html.*do not enter passwords/i)
    ).toBeInTheDocument();
    expect(dialog.querySelector('video')).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('accepts the fullscreen Escape bridge only from the current HTML slide', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body><button>Interactive control</button></body></html>',
    } as Response);
    const neighborHtml = artifact({
      ...gameHtml,
      fileName: 'neighbor.html',
      id: 'artifact-html-neighbor',
      previewUrl: 'https://files.example.com/neighbor.html',
      submissionId: 'sub-html-neighbor',
    });
    const user = userEvent.setup();

    renderPanel([
      submission('sub-html', '0x7777777777777777777777777777777777777777', [gameHtml]),
      submission('sub-html-neighbor', '0x8888888888888888888888888888888888888888', [neighborHtml]),
    ]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByTitle(/Interactive preview of/i);
    await user.click(within(dialog).getByRole('button', { name: 'Enter full screen' }));

    const currentFrame = dialog.querySelector(
      '[data-gallery-current="true"] iframe'
    ) as HTMLIFrameElement;
    const neighborFrame = dialog.querySelector('[aria-hidden="true"] iframe') as HTMLIFrameElement;
    fireEvent(
      window,
      new MessageEvent('message', {
        data: INTERACTIVE_HTML_ESCAPE_MESSAGE,
        source: neighborFrame.contentWindow,
      })
    );
    expect(dialog).toHaveAttribute('data-full-viewport', 'true');

    fireEvent(
      window,
      new MessageEvent('message', {
        data: INTERACTIVE_HTML_ESCAPE_MESSAGE,
        source: currentFrame.contentWindow,
      })
    );
    expect(dialog).toHaveAttribute('data-full-viewport', 'false');

    fetchMock.mockRestore();
  });

  it('does not render an iframe for an HTML artifact over the interactive preview size limit', async () => {
    const oversizedHtml = artifact({
      fileName: 'oversized.html',
      id: 'artifact-html-oversized',
      mediaKind: 'text',
      mimeType: 'text/html',
      previewUrl: 'https://files.example.com/oversized.html',
      sizeBytes: MAX_INTERACTIVE_HTML_BYTES + 1,
      submissionId: 'sub-html-oversized',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();

    renderPanel([
      submission('sub-html-oversized', '0x8888888888888888888888888888888888888888', [
        oversizedHtml,
      ]),
    ]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/exceeds the 5 mb interactive preview limit/i)
    ).toBeInTheDocument();
    expect(dialog.querySelector('iframe')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('mounts at most 3 panes even with 150 entries (windowed mounting)', async () => {
    const htmlContent = '<html><body><output>ready</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const manyArtifacts = Array.from({ length: 150 }, (_, index) =>
      artifact({
        fileName: `game-${index}.html`,
        id: `artifact-html-${index}`,
        mediaKind: 'text',
        mimeType: 'text/html',
        previewUrl: `https://files.example.com/game-${index}.html`,
        submissionId: `sub-html-${index}`,
      })
    );
    const manySubmissions = manyArtifacts.map((item, index) =>
      submission(
        `sub-html-${index}`,
        '0x9999999999999999999999999999999999999999',
        [item],
        `2026-02-01T00:00:00.${String(index).padStart(3, '0')}Z`
      )
    );

    renderPanel(manySubmissions);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByTitle(/Interactive preview of/i);

    expect(dialog.querySelectorAll('iframe')).toHaveLength(3);

    fetchMock.mockRestore();
  });

  it('recenters the mounted window on the new index after advancing', async () => {
    const htmlContent = '<html><body><output>ready</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const manyArtifacts = Array.from({ length: 6 }, (_, index) =>
      artifact({
        fileName: `game-${index}.html`,
        id: `artifact-html-${index}`,
        mediaKind: 'text',
        mimeType: 'text/html',
        previewUrl: `https://files.example.com/game-${index}.html`,
        submissionId: `sub-html-${index}`,
      })
    );
    // LiveActivityPanel sorts submissions newest-first, so a descending timestamp per
    // index keeps entries[i] matching artifact i (see the module-level `submissions`
    // fixture above for the same convention).
    const manySubmissions = manyArtifacts.map((item, index) =>
      submission(
        `sub-html-${index}`,
        '0x9999999999999999999999999999999999999999',
        [item],
        `2026-02-01T00:00:${String(manyArtifacts.length - index).padStart(2, '0')}.000Z`
      )
    );

    renderPanel(manySubmissions);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByTitle(/Interactive preview of/i);
    expect(dialog.querySelectorAll('iframe')).toHaveLength(3);
    // Starting at index 0, the window holds entries 5 (wrap), 0, and 1.
    expect(dialog.querySelectorAll('[title="Interactive preview of game-2.html"]')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: /next artifact/i }));
    await within(dialog).findByTitle('Interactive preview of game-2.html');

    // The window recenters on index 1: entries 0, 1, and 2 are now mounted, and the
    // far entry (5) that fell outside the new window is unmounted.
    expect(dialog.querySelectorAll('iframe')).toHaveLength(3);
    expect(dialog.querySelectorAll('[title="Interactive preview of game-5.html"]')).toHaveLength(0);
    expect(within(dialog).getByTitle('Interactive preview of game-0.html')).toBeInTheDocument();
    expect(within(dialog).getByTitle('Interactive preview of game-1.html')).toBeInTheDocument();
    expect(within(dialog).getByTitle('Interactive preview of game-2.html')).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('swipes to the next entry from the start gutter and back with the end gutter', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();

    const startGutter = within(dialog).getByTestId('gallery-swipe-gutter-start');
    fireEvent.pointerDown(startGutter, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(startGutter, { clientX: 200, clientY: 200 });

    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();

    const endGutter = within(dialog).getByTestId('gallery-swipe-gutter-end');
    fireEvent.pointerDown(endGutter, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(endGutter, { clientX: 300, clientY: 200 });

    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('ignores a short drag under the swipe threshold and a mostly-vertical drag', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const startGutter = within(dialog).getByTestId('gallery-swipe-gutter-start');

    // Short horizontal drag: below the swipe threshold.
    fireEvent.pointerDown(startGutter, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(startGutter, { clientX: 290, clientY: 200 });
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();

    // Long drag, but mostly vertical: reads as a scroll gesture, not a swipe.
    fireEvent.pointerDown(startGutter, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(startGutter, { clientX: 260, clientY: 400 });
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('does not navigate from a pointer sequence that originates over the media content region', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();

    // The content region (the image itself, standing in for any mounted media pane
    // -- image, video, or interactive HTML iframe) carries no swipe handlers at all,
    // so even a large horizontal drag starting there must not steal the gesture from
    // whatever the content itself would otherwise do with it.
    const content = within(dialog).getByAltText('poster-a.png');
    fireEvent.pointerDown(content, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(content, { clientX: 100, clientY: 200 });

    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('renders the overlay rail as pointer-events-none with pointer-events-auto only on its interactive controls', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const rail = within(dialog).getByTestId('gallery-overlay-rail');
    expect(rail).toHaveClass('pointer-events-none');

    const positionLabel = within(rail).getByText('1 / 3');
    expect(positionLabel).toHaveClass('pointer-events-auto');

    const workerLink = within(rail).getByRole('link');
    expect(workerLink.closest('[data-testid="gallery-overlay-rail"] span')).toHaveClass(
      'pointer-events-auto'
    );
  });

  it('announces the new position via aria-live after a swipe, matching chevron/keyboard navigation', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const liveRegion = dialog.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(liveRegion.textContent).toContain('Item 1 of 3');

    const startGutter = within(dialog).getByTestId('gallery-swipe-gutter-start');
    fireEvent.pointerDown(startGutter, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(startGutter, { clientX: 200, clientY: 200 });

    expect(liveRegion.textContent).toContain('Item 2 of 3');
  });

  it('positions panes with a static transform and no motion transition under reduced motion', async () => {
    // useMotionDisabled() is unconditionally true in this test environment (jsdom /
    // NODE_ENV=test), mirroring how every other animated market component is
    // exercised -- see components/market/motion/use-motion-disabled.ts and
    // burst-stages.test.tsx. The gallery must therefore take the same static,
    // no-transition branch AnimatedRow (live-activity.tsx) takes when motion is
    // disabled: a plain div positioned with a Tailwind transform class, never a
    // motion.div with an animate/transition prop.
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByAltText('poster-a.png');

    const panes = dialog.querySelectorAll('.-translate-x-full, .translate-x-0, .translate-x-full');
    // Entries.length is 3 here, so the window mounts exactly prev/current/next.
    expect(panes).toHaveLength(3);
    expect(dialog.querySelector('.translate-x-0')).not.toBeNull();
    expect(dialog.querySelector('.-translate-x-full')).not.toBeNull();
    expect(dialog.querySelector('.translate-x-full')).not.toBeNull();
  });

  it('wraps around via swipe exactly like the chevrons do', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const startGutter = within(dialog).getByTestId('gallery-swipe-gutter-start');

    // Swipe backward from the first entry: wraps to the last, same as ArrowLeft/the
    // "Previous artifact" chevron.
    fireEvent.pointerDown(startGutter, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(startGutter, { clientX: 300, clientY: 200 });
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();

    // Swipe forward from the last entry: wraps back to the first.
    fireEvent.pointerDown(startGutter, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(startGutter, { clientX: 200, clientY: 200 });
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();
  });

  it('does not prefetch an interactive HTML neighbor as an image', async () => {
    // The prefetch effect assigns `src` on a real Image instance, which jsdom would
    // otherwise try to resolve as a network request; a lightweight stand-in captures
    // the assigned URLs instead so the test can assert on them directly.
    const assignedSrcs: string[] = [];
    class FakeImage {
      set src(value: string) {
        assignedSrcs.push(value);
      }
    }
    const imageSpy = vi
      .spyOn(window, 'Image')
      .mockImplementation(FakeImage as unknown as new () => HTMLImageElement);
    const user = userEvent.setup();

    renderPanel([
      submission('sub-1', '0x3333333333333333333333333333333333333333', [imageA]),
      submission(
        'sub-html',
        '0x7777777777777777777777777777777777777777',
        [gameHtml],
        '2026-01-03T00:00:00.000Z'
      ),
    ]);

    await user.click(screen.getByRole('button', { name: /open poster-a\.png preview/i }));
    await screen.findByRole('dialog');

    // The HTML artifact's URL must never be treated as a prefetchable image src,
    // regardless of which entry the neighbor-warming effect lands on.
    expect(assignedSrcs).not.toContain(gameHtml.previewUrl);

    imageSpy.mockRestore();
  });
});

describe('SubmissionGalleryDialog mobile surface', () => {
  afterEach(() => {
    setupMatchMedia(1280);
  });

  it('renders the drawer surface, not the centered dialog, below the md breakpoint', async () => {
    setupMatchMedia(390);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter full screen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit full screen' })).not.toBeInTheDocument();
  });

  it('shows the actionable video fallback after bounded recovery is exhausted', async () => {
    setupMatchMedia(390);
    const freshUrl = 'https://files.example.com/walkthrough.mp4?sig=recovered';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        previewUrl: freshUrl,
      }),
      ok: true,
    } as Response);
    const videoSubmission = submission('sub-video', '0x4444444444444444444444444444444444444444', [
      videoC,
    ]);
    render(
      directGallery({
        entries: [galleryEntry(videoC, videoSubmission)],
        initialArtifactId: videoC.id,
      })
    );

    const dialog = await screen.findByRole('dialog');
    const video = dialog.querySelector('video') as HTMLVideoElement;
    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    fireEvent.error(video);

    const fallback = await within(dialog).findByRole('alert');
    expect(fallback).toHaveTextContent('This video cannot be played in your browser.');
    expect(within(fallback).getByRole('link', { name: 'Open artifact' })).toHaveAttribute(
      'href',
      freshUrl
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fits video to its intrinsic aspect ratio while interactive HTML keeps the tall playfield', async () => {
    setupMatchMedia(390);
    const videoSubmission = submission('sub-video', '0x4444444444444444444444444444444444444444', [
      videoC,
    ]);
    const { unmount } = render(
      directGallery({
        entries: [galleryEntry(videoC, videoSubmission)],
        initialArtifactId: videoC.id,
      })
    );

    const videoDialog = await screen.findByRole('dialog');
    const videoFrame = within(videoDialog).getByTestId('gallery-frame');
    const video = videoDialog.querySelector('video') as HTMLVideoElement;
    Object.defineProperties(video, {
      videoHeight: { configurable: true, value: 900 },
      videoWidth: { configurable: true, value: 2100 },
    });
    fireEvent.loadedMetadata(video);

    expect(videoFrame).toHaveStyle({ aspectRatio: `${2100 / 900}` });
    expect(videoFrame).not.toHaveClass('h-full');
    expect(within(videoDialog).getByTestId('gallery-mobile-footer')).toBeInTheDocument();

    unmount();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body><output>ready</output></body></html>',
    } as Response);
    const htmlSubmission = submission('sub-html', '0x7777777777777777777777777777777777777777', [
      gameHtml,
    ]);
    render(
      directGallery({
        entries: [galleryEntry(gameHtml, htmlSubmission)],
        initialArtifactId: gameHtml.id,
      })
    );

    const htmlDialog = await screen.findByRole('dialog');
    await within(htmlDialog).findByTitle('Interactive preview of game.html');
    expect(within(htmlDialog).getByTestId('gallery-frame')).toHaveClass('h-full');
    expect(within(htmlDialog).getByTestId('gallery-mobile-footer')).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('shows an optional context label above the mobile playfield', async () => {
    setupMatchMedia(390);
    const firstSubmission = submission('sub-1', '0x3333333333333333333333333333333333333333', [
      imageA,
    ]);

    render(
      directGallery({
        contextLabel: 'Rejected submission history',
        entries: [galleryEntry(imageA, firstSubmission)],
      })
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rejected submission history')).toBeVisible();
  });

  it('still uses the centered dialog at and above the md breakpoint (regression guard)', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeInTheDocument();
  });

  it('does not render the filename or a duplicated submitted-by line for a non-HTML artifact', async () => {
    setupMatchMedia(390);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const footer = await screen.findByTestId('gallery-mobile-footer');
    expect(
      within(footer).queryByRole('button', { name: /untrusted html/i })
    ).not.toBeInTheDocument();

    // "Submitted by" appears exactly once (in the visually-hidden accessible
    // description), never as a second visible line duplicating the overlay rail's
    // own worker/time chip.
    const submittedByNodes = within(dialog).getAllByText(/submitted by/i);
    expect(submittedByNodes).toHaveLength(1);
    expect(submittedByNodes[0]?.closest('[data-slot="drawer-header"]')).toHaveClass('sr-only');
  });

  it('still exposes the filename and worker as an accessible (visually hidden) name/description', async () => {
    setupMatchMedia(390);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/submission gallery: poster-a\.png/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/submitted by/i)).toBeInTheDocument();
  });

  it('shows only the collapsed warning chip in the footer for an interactive HTML artifact, never the filename', async () => {
    setupMatchMedia(390);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body><output>ready</output></body></html>',
    } as Response);
    const user = userEvent.setup();

    renderPanel([submission('sub-html', '0x7777777777777777777777777777777777777777', [gameHtml])]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTitle('Interactive preview of game.html');

    const footer = await screen.findByTestId('gallery-mobile-footer');
    expect(footer.textContent).not.toMatch(/game\.html/i);
    expect(within(footer).getByRole('button', { name: /untrusted html/i })).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('keeps the untrusted-HTML warning reachable behind the footer chip and reveals the full text on tap', async () => {
    setupMatchMedia(390);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body><output>ready</output></body></html>',
    } as Response);
    const user = userEvent.setup();

    renderPanel([submission('sub-html', '0x7777777777777777777777777777777777777777', [gameHtml])]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTitle('Interactive preview of game.html');

    expect(
      within(dialog).queryByText(/untrusted interactive html.*do not enter passwords/i)
    ).not.toBeInTheDocument();

    const chip = screen.getByRole('button', { name: /untrusted html/i });
    await user.click(chip);

    expect(
      within(dialog).getByText(/untrusted interactive html.*do not enter passwords/i)
    ).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('never lets the warning chip and the overlay rail occupy the same stacking layer', async () => {
    setupMatchMedia(390);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body><output>ready</output></body></html>',
    } as Response);
    const user = userEvent.setup();

    renderPanel([submission('sub-html', '0x7777777777777777777777777777777777777777', [gameHtml])]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTitle('Interactive preview of game.html');

    const chip = screen.getByRole('button', { name: /untrusted html/i });
    const overlayRail = within(dialog).getByTestId('gallery-overlay-rail');
    const frame = within(dialog).getByTestId('gallery-frame');

    // The chip must live outside both the overlay rail and the media frame it
    // floats over -- otherwise the two absolutely-positioned layers can render on
    // top of one another, as they did before this fix.
    expect(overlayRail.contains(chip)).toBe(false);
    expect(frame.contains(chip)).toBe(false);

    fetchMock.mockRestore();
  });

  it('mounts the chevrons transparent and non-interactive on mobile but keeps them in the accessibility tree', async () => {
    setupMatchMedia(390);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    // jsdom has no CSS engine, so a real "is it painted over content" check isn't
    // available here -- these class names are exactly what encodes that contract
    // (invisible and untouchable by default, restored the moment keyboard focus
    // lands, mirroring a skip-link) and are exercised for real in the compiled
    // Tailwind build powering `make ui-ci`'s Playwright pass.
    const prev = within(dialog).getByRole('button', { name: /previous artifact/i });
    const next = within(dialog).getByRole('button', { name: /next artifact/i });

    expect(prev).toHaveClass('opacity-0', 'pointer-events-none');
    expect(next).toHaveClass('opacity-0', 'pointer-events-none');
    expect(prev).toHaveClass('focus-visible:opacity-100', 'focus-visible:pointer-events-auto');
    expect(next).toHaveClass('focus-visible:opacity-100', 'focus-visible:pointer-events-auto');
  });

  it('keeps the chevrons visible and interactive on desktop (regression guard)', async () => {
    setupMatchMedia(1280);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const prev = within(dialog).getByRole('button', { name: /previous artifact/i });
    const next = within(dialog).getByRole('button', { name: /next artifact/i });

    expect(prev).not.toHaveClass('opacity-0');
    expect(next).not.toHaveClass('opacity-0');
  });

  it('mounts at most 3 panes even with 50 entries on mobile (windowed mounting regression)', async () => {
    setupMatchMedia(390);
    const htmlContent = '<html><body><output>ready</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const manyArtifacts = Array.from({ length: 50 }, (_, index) =>
      artifact({
        fileName: `game-${index}.html`,
        id: `artifact-html-${index}`,
        mediaKind: 'text',
        mimeType: 'text/html',
        previewUrl: `https://files.example.com/game-${index}.html`,
        submissionId: `sub-html-${index}`,
      })
    );
    const manySubmissions = manyArtifacts.map((item, index) =>
      submission(
        `sub-html-${index}`,
        '0x9999999999999999999999999999999999999999',
        [item],
        `2026-02-01T00:00:${String(index).padStart(2, '0')}.000Z`
      )
    );

    renderPanel(manySubmissions);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByTitle(/Interactive preview of/i);

    expect(dialog.querySelectorAll('iframe')).toHaveLength(3);

    fetchMock.mockRestore();
  });

  it('navigates with wrap-around, arrow keys, and aria-live on mobile (regression guard)', async () => {
    setupMatchMedia(390);
    const user = userEvent.setup();
    renderPanel();

    const dialogButton = screen.getByRole('button', { name: /gallery/i });
    await user.click(dialogButton);

    const dialog = await screen.findByRole('dialog');
    const liveRegion = dialog.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(liveRegion.textContent).toContain('Item 1 of 3');
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();

    const startGutter = within(dialog).getByTestId('gallery-swipe-gutter-start');
    fireEvent.pointerDown(startGutter, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(startGutter, { clientX: 200, clientY: 200 });
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
    expect(liveRegion.textContent).toContain('Item 2 of 3');

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('1 / 3')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
  });

  it('keeps the iframe sandboxed to allow-scripts on mobile (regression guard)', async () => {
    setupMatchMedia(390);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body><output>ready</output></body></html>',
    } as Response);
    const user = userEvent.setup();

    renderPanel([submission('sub-html', '0x7777777777777777777777777777777777777777', [gameHtml])]);

    await user.click(screen.getByRole('button', { name: /gallery/i }));

    const dialog = await screen.findByRole('dialog');
    const frame = await within(dialog).findByTitle('Interactive preview of game.html');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('allow', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");

    fetchMock.mockRestore();
  });
});
