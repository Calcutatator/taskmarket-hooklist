// storybook-coverage: components/market/artifact-poster.tsx
// storybook-coverage: components/market/artifact-preview-button.tsx
// storybook-coverage: components/market/interactive-html-preview.tsx
// storybook-coverage: components/market/live-activity.tsx
// storybook-coverage: components/market/private-task-access-gate.tsx
// storybook-coverage: components/market/published-html-result.tsx
// storybook-coverage: components/market/resilient-artifact-video.tsx
// storybook-coverage: components/market/submission-gallery.tsx
// storybook-coverage: components/market/task-description-disclosure.tsx
// storybook-coverage: components/market/task-participation-module.tsx
// storybook-coverage: components/market/task-review-status.tsx
// storybook-coverage: components/market/tasks/live-status-banner.tsx
// storybook-coverage: components/market/worker-submission-actions.tsx
// storybook-coverage: components/market/worker-submission-history.tsx

import type { PendingAction } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useEffect, useState, type ReactNode } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { base, baseSepolia } from 'viem/chains';
import { createConfig, http, useAccount, useConnect, WagmiProvider } from 'wagmi';
import { mock } from 'wagmi/connectors';

import { ArtifactPoster } from '@/components/market/artifact-poster';
import {
  ArtifactMediaHero,
  ArtifactMediaThumb,
  ArtifactMediaTile,
  ArtifactMetadata,
  ArtifactPreviewButton,
} from '@/components/market/artifact-preview-button';
import {
  InteractiveHtmlPreview,
  UntrustedHtmlWarningChip,
  UntrustedHtmlWarningNote,
} from '@/components/market/interactive-html-preview';
import { LiveActivityPanel } from '@/components/market/live-activity';
import { PrivateTaskAccessGate } from '@/components/market/private-task-access-gate';
import { ResilientArtifactVideo } from '@/components/market/resilient-artifact-video';
import {
  SubmissionGalleryDialog,
  submissionMediaEntries,
} from '@/components/market/submission-gallery';
import { TaskDescriptionDisclosure } from '@/components/market/task-description-disclosure';
import { TaskParticipationModule } from '@/components/market/task-participation-module';
import { TaskReviewStatus } from '@/components/market/task-review-status';
import { TaskDetailPanel } from '@/components/market/tasks';
import { LiveStatusBanner } from '@/components/market/tasks/live-status-banner';
import { WorkerSubmissionActions } from '@/components/market/worker-submission-actions';
import { WorkerSubmissionHistory } from '@/components/market/worker-submission-history';
import { Button } from '@/components/ui/button';
import { groupSubmissionsByWorker } from '@/lib/market/submission-review';

import { addresses, artifactFixture, submissionFixture, taskDetailFixture } from './fixtures';

function SubmissionCatalog() {
  return <div>Taskmarket artifacts and submissions</div>;
}

const meta = {
  component: SubmissionCatalog,
  title: 'Product/Artifacts and submissions',
} satisfies Meta<typeof SubmissionCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

function createSubmissionReviewConfig() {
  return createConfig({
    chains: [base, baseSepolia],
    connectors: [mock({ accounts: [addresses.requester] })],
    transports: {
      [base.id]: http(),
      [baseSepolia.id]: http(),
    },
  });
}

function ConnectSubmissionReviewWallet({ children }: Readonly<{ children: ReactNode }>) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (!isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [connect, connectors, isConnected]);

  return isConnected ? children : <p className="text-sm text-muted-foreground">Connecting...</p>;
}

function ConnectedSubmissionRequester({ children }: Readonly<{ children: ReactNode }>) {
  const [config] = useState(createSubmissionReviewConfig);

  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <ConnectSubmissionReviewWallet>{children}</ConnectSubmissionReviewWallet>
    </WagmiProvider>
  );
}

const imageArtifact = artifactFixture();
const documentArtifact = artifactFixture({
  fileName: 'protocol-review.pdf',
  id: 'artifact-pdf',
  mediaKind: 'pdf',
  mimeType: 'application/pdf',
  previewUrl: undefined,
  role: 'final',
  sizeBytes: 4_200_000,
  storageUri: 'ipfs://bafybeifake/protocol-review.pdf',
});
const htmlSource = encodeURIComponent(
  '<!doctype html><html><body style="font-family:system-ui;background:#151318;color:#f7f2ef;padding:32px"><h1>Interactive task result</h1><button>Run analysis</button></body></html>'
);
const htmlArtifact = artifactFixture({
  fileName: 'interactive-report.html',
  id: 'artifact-html',
  mediaKind: 'text',
  mimeType: 'text/html',
  previewUrl: `data:text/html;charset=utf-8,${htmlSource}`,
  role: 'final',
  sha256Hash: '4699a6f3308e3540f970a6c2a0b75c349990083fe9a8e915f3e652f1a4849a7d',
  sizeBytes: 812,
  storageUri: 'ipfs://bafybeifake/interactive-report.html',
});
const secondaryHtmlArtifact = artifactFixture({
  ...htmlArtifact,
  fileName: 'interactive-dashboard.html',
  id: 'artifact-html-dashboard',
  storageUri: 'ipfs://bafybeifake/interactive-dashboard.html',
});
const videoArtifact = artifactFixture({
  fileName: 'demo.mp4',
  id: 'artifact-video',
  mediaKind: 'video',
  mimeType: 'video/mp4',
  previewUrl: undefined,
  role: 'final',
  sizeBytes: 18_000_000,
  storageUri: 'ipfs://bafybeifake/demo.mp4',
});

export const ArtifactTileVariants: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-6 md:grid-cols-3">
      <ArtifactMediaTile artifact={imageArtifact} taskId="task-1" />
      <ArtifactMediaTile artifact={documentArtifact} taskId="task-1" />
      <ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />
      <ArtifactMediaHero artifact={imageArtifact} taskId="task-1" />
      <ArtifactMediaThumb artifact={imageArtifact} taskId="task-1" />
      <div className="grid content-start gap-4">
        <ArtifactMetadata artifact={imageArtifact} previewUrl={imageArtifact.previewUrl ?? null} />
        <ArtifactPreviewButton artifact={imageArtifact} taskId="task-1" />
      </div>
    </div>
  ),
};

export const InteractiveHtmlStates: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-6">
      <UntrustedHtmlWarningNote />
      <UntrustedHtmlWarningChip />
      <InteractiveHtmlPreview artifact={htmlArtifact} previewUrl={htmlArtifact.previewUrl ?? ''} />
      <InteractiveHtmlPreview
        artifact={{ ...htmlArtifact, sizeBytes: 50_000_000 }}
        previewUrl={htmlArtifact.previewUrl ?? ''}
      />
    </div>
  ),
};

export const PostersAndVideoFallbacks: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-6 md:grid-cols-2">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border/58">
        <ArtifactPoster
          artifact={htmlArtifact}
          fallback={<div className="grid h-full place-items-center">Poster unavailable</div>}
          previewUrl={htmlArtifact.previewUrl ?? null}
        />
      </div>
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border/58">
        <ResilientArtifactVideo
          artifact={videoArtifact}
          className="h-full w-full object-cover"
          fallback={<div className="grid h-full place-items-center">Video preview unavailable</div>}
          fetchMissingPreview={false}
          initialPreviewUrl={null}
        />
      </div>
    </div>
  ),
};

const submissions = [
  submissionFixture(),
  submissionFixture({
    artifacts: [htmlArtifact],
    id: 'submission-2',
    submittedAt: '2026-08-02T03:00:00.000Z',
  }),
  submissionFixture({
    artifacts: [documentArtifact],
    id: 'submission-3',
    submittedAt: '2026-08-02T04:00:00.000Z',
  }),
];
const reviewSubmissions = [
  submissionFixture({
    artifacts: [
      artifactFixture({
        id: 'artifact-review-a',
        previewUrl:
          'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop',
        submissionId: 'submission-review-a',
        taskId: 'task-1',
        workerAddress: addresses.worker,
        workerAgentId: '42',
      }),
    ],
    id: 'submission-review-a',
    submittedAt: '2026-08-02T04:00:00.000Z',
    taskId: 'task-1',
    workerAddress: addresses.worker,
    workerAgentId: '42',
  }),
  submissionFixture({
    artifacts: [
      {
        ...htmlArtifact,
        id: 'artifact-review-b',
        submissionId: 'submission-review-b',
        taskId: 'task-1',
        workerAddress: addresses.workerB,
        workerAgentId: '84',
      },
    ],
    id: 'submission-review-b',
    submittedAt: '2026-08-02T03:00:00.000Z',
    taskId: 'task-1',
    workerAddress: addresses.workerB,
    workerAgentId: '84',
  }),
];
const longQueueSubmissions = Array.from({ length: 13 }, (_, index) => {
  const ordinal = index + 1;
  const workerAddress = `0x${ordinal.toString(16).padStart(40, '0')}`;
  const submissionId = `submission-long-queue-${ordinal}`;

  return submissionFixture({
    artifacts: [
      artifactFixture({
        id: `artifact-long-queue-${ordinal}`,
        submissionId,
        taskId: 'task-1',
        workerAddress,
        workerAgentId: String(100 + ordinal),
      }),
    ],
    id: submissionId,
    submittedAt: new Date(Date.UTC(2026, 7, 2, 4, ordinal)).toISOString(),
    taskId: 'task-1',
    workerAddress,
    workerAgentId: String(100 + ordinal),
  });
});
const interactiveGallerySubmissions = [
  submissionFixture({ artifacts: [imageArtifact], id: 'submission-gallery-image' }),
  submissionFixture({
    artifacts: [htmlArtifact],
    id: 'submission-gallery-html-report',
    submittedAt: '2026-08-02T03:00:00.000Z',
  }),
  submissionFixture({
    artifacts: [secondaryHtmlArtifact],
    id: 'submission-gallery-html-dashboard',
    submittedAt: '2026-08-02T02:00:00.000Z',
  }),
];
const groups = groupSubmissionsByWorker(submissions);
const group = groups.activeGroups[0];
const acceptAction: PendingAction = {
  action: 'accept',
  command: `taskmarket task accept task-1 --worker ${addresses.worker}`,
  role: 'requester',
  targetWorker: addresses.worker,
};
const rejectAction: PendingAction = {
  action: 'reject_submission',
  command: `taskmarket task reject-submission task-1 --worker ${addresses.worker}`,
  role: 'requester',
};
const reviewTask = taskDetailFixture({
  claimedBy: addresses.worker,
  id: 'task-1',
  pendingActions: [acceptAction, rejectAction],
  status: 'pending_approval',
  submissionCount: submissions.length,
});
const longBriefReviewTask = taskDetailFixture({
  ...reviewTask,
  description: `Review the Taskmarket protocol documentation

Compare the current task, submission, and evaluator guidance across the public docs and agent-facing skill bundle. Identify inconsistencies, missing edge cases, and the highest-impact opportunities to make the workflow easier to follow.

DELIVERABLES
A prioritized review with direct references, recommended copy, and a short rationale for every proposed change.

QUALITY BAR
Keep the recommendations specific enough that another contributor can implement them without reconstructing the research.`,
  tags: ['research', 'protocol', 'long-brief'],
});

export const CollapsedTaskDescription: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => (
    <div className="max-w-2xl">
      <TaskDescriptionDisclosure>
        <div className="grid gap-4 text-sm leading-6 text-muted-foreground">
          <p>
            Review every submission against the task brief and document the evidence behind the
            final decision.
          </p>
          <p>
            Check visual hierarchy, interaction quality, keyboard access, responsive behavior, and
            whether the submitted result covers every requested state. Record direct references for
            each strength or gap so the evaluation can be acted on without additional research.
          </p>
          <p>
            Confirm the final artifact remains usable at desktop and mobile widths before releasing
            escrow.
          </p>
        </div>
      </TaskDescriptionDisclosure>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const description = canvas.getByRole('group', { name: 'Description' });
    const descriptionBody = within(description).getByTestId('task-description-body');
    const showFullDescription = within(description).getByRole('button', {
      name: 'Show full description',
    });

    await expect(showFullDescription).toHaveAttribute('aria-expanded', 'false');
    await expect(descriptionBody).toHaveAttribute('data-collapsed', 'true');
    await expect(within(description).getByTestId('task-description-fade')).toBeVisible();

    await userEvent.click(showFullDescription);

    await expect(
      within(description).getByRole('button', { name: 'Collapse description' })
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(descriptionBody).toHaveAttribute('data-collapsed', 'false');
    await expect(
      within(description).queryByTestId('task-description-fade')
    ).not.toBeInTheDocument();
  },
};

export const TaskDetailReviewFirst: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => (
    <TaskDetailPanel
      backHref="/tasks"
      htmlSubmissions={submissions}
      modeData={{ submissions }}
      profileBasePath="/agents"
      task={longBriefReviewTask}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const description = canvas.getByRole('group', { name: 'Description' });
    const descriptionBody = within(description).getByTestId('task-description-body');
    const submissionReview = canvas.getByRole('heading', { name: 'Submission review' });
    const taskDetailsSummary = canvas.getByText('Task details', { selector: 'summary' });
    const taskDetails = taskDetailsSummary.closest('details');
    const publishedResult = within(description).getByRole('link', {
      name: /open interactive result/i,
    });
    const briefCopy = within(description).getByText(
      /Identify inconsistencies, missing edge cases/i
    );

    const showFullDescription = within(description).getByRole('button', {
      name: 'Show full description',
    });
    await expect(showFullDescription).toHaveAttribute('aria-expanded', 'false');
    await expect(descriptionBody).toHaveAttribute('data-collapsed', 'true');
    await expect(descriptionBody).toHaveClass('max-h-[200px]', 'overflow-hidden');
    await expect(within(description).getByTestId('task-description-fade')).toBeVisible();
    await expect(briefCopy).toBeVisible();
    await expect(publishedResult).toHaveAttribute('href', '/tasks/task-1?artifact=artifact-html');
    await expect(
      within(description).getByRole('button', { name: 'Share interactive result' })
    ).toBeVisible();
    await expect(
      within(description).getByRole('button', { name: 'Copy interactive result link' })
    ).toBeVisible();
    await expect(
      Boolean(
        submissionReview.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
    await expect(canvas.queryByLabelText('Bonus summary')).not.toBeInTheDocument();
    await expect(taskDetails).not.toBeNull();
    await expect(taskDetails).not.toHaveAttribute('open');

    await userEvent.click(taskDetailsSummary);
    await expect(taskDetails).toHaveAttribute('open');
    await userEvent.click(taskDetailsSummary);
    await expect(taskDetails).not.toHaveAttribute('open');

    await userEvent.click(showFullDescription);
    await expect(
      within(description).getByRole('button', { name: 'Collapse description' })
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(descriptionBody).toHaveAttribute('data-collapsed', 'false');
    await expect(descriptionBody).not.toHaveClass('max-h-[200px]', 'overflow-hidden');
    await expect(
      within(description).queryByTestId('task-description-fade')
    ).not.toBeInTheDocument();
    await expect(briefCopy).toBeVisible();
    await expect(canvas.getByText('long-brief', { exact: true })).toBeVisible();

    await userEvent.click(
      within(description).getByRole('button', { name: 'Collapse description' })
    );
    await expect(showFullDescription).toHaveAttribute('aria-expanded', 'false');
    await expect(descriptionBody).toHaveAttribute('data-collapsed', 'true');
  },
};

export const TaskDetailReviewFirstMobile: Story = {
  globals: { theme: 'dark' },
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'mobile' },
  },
  render: () => (
    <TaskDetailPanel
      backHref="/tasks"
      htmlSubmissions={submissions}
      modeData={{ submissions }}
      profileBasePath="/agents"
      task={longBriefReviewTask}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nextAction = canvas.getByRole('heading', { name: 'Next action' });
    const submissionReview = canvas.getByRole('heading', { name: 'Submission review' });

    await expect(nextAction).toBeVisible();
    await expect(
      Boolean(
        nextAction.compareDocumentPosition(submissionReview) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);
    await expect(canvas.getByText('3 submissions ready for review.')).toBeVisible();
  },
};

function SubmissionReviewSurface() {
  return (
    <ConnectedSubmissionRequester>
      <main className="mx-auto min-h-app-viewport max-w-6xl bg-background py-8">
        <LiveActivityPanel
          initialModeData={{ submissions: reviewSubmissions }}
          marketStats={null}
          profileBasePath="/agents"
          reviewActions={{ acceptAction, rejectAction }}
          submissionReviewEligible
          task={{ ...reviewTask, reward: '250000000', status: 'completed' }}
        />
      </main>
    </ConnectedSubmissionRequester>
  );
}

export const SubmissionReviewGalleryAndList: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => <SubmissionReviewSurface />,
};

export const SubmissionReviewGalleryAndListInteraction: Story = {
  ...SubmissionReviewGalleryAndList,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const choices = await canvas.findAllByRole('radio');
    const secondChoice = choices[1];
    if (!secondChoice) throw new Error('Second submission choice did not render.');

    await expect(canvas.getByTestId('submission-decision-bar')).toHaveTextContent(
      'Select a submitter above'
    );
    await userEvent.click(secondChoice);
    await expect(secondChoice).toBeChecked();
    await expect(canvas.getByTestId('submission-decision-bar')).toHaveTextContent(
      'receives 250 USDC'
    );
    await expect(canvas.getByRole('button', { name: 'Award 250 USDC' })).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'List view' }));
    await expect(secondChoice).toBeChecked();
    await userEvent.click(canvas.getByRole('button', { name: 'Gallery view' }));

    // Opening the gallery is a navigation now (ADR-0096): the trigger writes ?panel=submissions
    // rather than flipping local state, so what this story can assert in isolation is that the
    // control requests it. That the resulting address actually renders the gallery is the
    // sibling story below, which starts from the deep link -- together they cover the round trip
    // that Storybook's per-story navigation mock cannot exercise in one pass.
    await expect(canvas.getByRole('button', { name: 'Preview' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
  },
};

/**
 * The gallery reached by its address alone, with no click to open it.
 *
 * This is the property ADR-0096 exists for: a viewer handed this URL sees the same screen the
 * sender was looking at. It is also the only way to exercise the open gallery under Storybook,
 * whose Next navigation mock is fixed per story.
 */
export const SubmissionReviewGalleryDeepLink: Story = {
  ...SubmissionReviewGalleryAndList,
  parameters: {
    ...SubmissionReviewGalleryAndList.parameters,
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/tasks/task-1',
        query: { artifact: 'artifact-review-a', panel: 'submissions' },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const documentBody = within(canvasElement.ownerDocument.body);

    const galleryFrame = await documentBody.findByTestId('gallery-frame');
    const dialog = galleryFrame.closest<HTMLElement>('[role="dialog"]');
    await expect(dialog).not.toBeNull();
    if (!dialog) throw new Error('Submission gallery dialog did not render from the URL.');

    const gallery = within(dialog);
    await userEvent.click(gallery.getByRole('button', { name: 'Enter full screen' }));
    await expect(dialog).toHaveAttribute('data-full-viewport', 'true');
  },
};

export const SubmissionReviewGalleryAndListMobile: Story = {
  globals: { theme: 'dark' },
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'mobile' },
  },
  render: () => <SubmissionReviewSurface />,
};

export const SubmissionReviewThreeColumnLongQueue: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => (
    <TaskDetailPanel
      backHref="/tasks"
      htmlSubmissions={longQueueSubmissions}
      modeData={{ submissions: longQueueSubmissions }}
      profileBasePath="/agents"
      task={{
        ...longBriefReviewTask,
        status: 'completed',
        submissionCount: longQueueSubmissions.length,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const comparison = canvas.getByRole('region', { name: 'Artifact comparison' });

    await expect(comparison).toHaveClass('xl:grid-cols-3');
    await expect(comparison.querySelectorAll('[data-testid^="submitter-group-"]')).toHaveLength(12);
    await expect(canvas.getByText('Showing 1-12 of 13 submitters')).toBeVisible();
    await expect(canvas.getByText('Page 1 of 2')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Next page' }));

    await expect(comparison.querySelectorAll('[data-testid^="submitter-group-"]')).toHaveLength(1);
    await expect(canvas.getByText('Showing 13-13 of 13 submitters')).toBeVisible();
    await expect(canvas.getByText('Page 2 of 2')).toBeVisible();
  },
};

export const OpenSubmissionGallery: Story = {
  parameters: {
    a11y: { test: 'error' },
  },
  render: () => (
    <SubmissionGalleryDialog
      contextLabel="Protocol review submissions"
      entries={submissionMediaEntries(submissions)}
      initialArtifactId={null}
      onOpenChange={() => undefined}
      open
      preferredArtifactType="image"
      profileBasePath="/agents"
      taskId="task-1"
    />
  ),
  play: async ({ canvasElement }) => {
    const documentBody = within(canvasElement.ownerDocument.body);
    const galleryFrame = await documentBody.findByTestId('gallery-frame');
    const dialog = galleryFrame.closest<HTMLElement>('[role="dialog"]');

    await expect(dialog).not.toBeNull();
    if (!dialog) {
      throw new Error('Submission gallery dialog did not render.');
    }

    const gallery = within(dialog);
    await expect(gallery.getByRole('button', { name: 'Filter gallery to Images' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(gallery.getByText('Task default')).toBeVisible();
    await expect(gallery.getByRole('img', { name: 'protocol-review.png' })).toBeVisible();

    const allFilter = gallery.getByRole('button', { name: 'Filter gallery to All' });

    await userEvent.click(allFilter);

    await expect(allFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(gallery.getByRole('button', { name: 'Previous artifact' })).toBeVisible();
    await expect(gallery.getByRole('button', { name: 'Next artifact' })).toBeVisible();
  },
};

export const FullscreenInteractiveHtmlGallery: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => (
    <SubmissionGalleryDialog
      contextLabel="Protocol review submissions"
      entries={submissionMediaEntries(interactiveGallerySubmissions)}
      initialArtifactId={null}
      onOpenChange={() => undefined}
      open
      profileBasePath="/agents"
      taskId="task-1"
    />
  ),
  play: async ({ canvasElement }) => {
    const documentBody = within(canvasElement.ownerDocument.body);
    const galleryFrame = await documentBody.findByTestId('gallery-frame');
    const dialog = galleryFrame.closest<HTMLElement>('[role="dialog"]');

    await expect(dialog).not.toBeNull();
    if (!dialog) {
      throw new Error('Submission gallery dialog did not render.');
    }
    const gallery = within(dialog);
    const htmlFilter = gallery.getByRole('button', { name: 'Filter gallery to HTML' });
    const imageFilter = gallery.getByRole('button', { name: 'Filter gallery to Images' });

    await expect(htmlFilter).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(imageFilter);
    await expect(imageFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(await gallery.findByAltText('protocol-review.png')).toBeVisible();
    await userEvent.click(htmlFilter);
    const frame = await gallery.findByTitle('Interactive preview of interactive-report.html');

    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(gallery.queryAllByTitle(/Interactive preview of/i)).toHaveLength(1);
    await userEvent.click(gallery.getByRole('button', { name: 'Next artifact' }));
    await expect(
      await gallery.findByTitle('Interactive preview of interactive-dashboard.html')
    ).toBeVisible();
    await expect(frame).not.toBeInTheDocument();
    await expect(gallery.queryAllByTitle(/Interactive preview of/i)).toHaveLength(1);
    const enterFullScreen = gallery.queryByRole('button', { name: 'Enter full screen' });
    if (!enterFullScreen) {
      await expect(gallery.getByRole('button', { name: 'Close submission gallery' })).toBeVisible();
      return;
    }

    await expect(dialog).toHaveAttribute('data-full-viewport', 'false');

    enterFullScreen.focus();
    await userEvent.keyboard('{Enter}');

    await expect(dialog).toHaveAttribute('data-full-viewport', 'true');
    const exitFullScreen = gallery.getByRole('button', { name: 'Exit full screen' });
    await expect(canvasElement.ownerDocument.activeElement).toBe(exitFullScreen);

    await userEvent.click(exitFullScreen);
    await expect(dialog).toHaveAttribute('data-full-viewport', 'false');
    await expect(gallery.getByRole('button', { name: 'Enter full screen' })).toBeVisible();
  },
};

export const SubmissionHistory: Story = {
  render: () =>
    group ? (
      <WorkerSubmissionHistory
        actionArea={<Button disabled>Review actions</Button>}
        group={group}
        initialView="gallery"
        onBack={() => undefined}
        profileBasePath="/agents"
        task={reviewTask}
        visibilityScopeKey="storybook"
      />
    ) : (
      <div>No submission group is available.</div>
    ),
};

export const SubmissionDecisionStates: Story = {
  render: () => (
    <div className="grid max-w-4xl gap-8">
      {group ? (
        <WorkerSubmissionActions
          acceptAction={acceptAction}
          group={group}
          onRejectSuccess={() => undefined}
          rejectAction={rejectAction}
          task={reviewTask}
        />
      ) : null}
      <TaskReviewStatus
        detail="The requester must review the latest active submission and release escrow."
        requester={addresses.requester}
        reviewRequired
        status="pending approval"
      />
      <TaskReviewStatus
        detail="The task has completed and settlement is final."
        requester={addresses.requester}
        reviewRequired={false}
        status="completed"
      />
    </div>
  ),
};

export const PrivateTaskGate: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <PrivateTaskAccessGate
      backHref="/tasks"
      browseAgentsHref="/agents"
      browseTasksHref="/tasks"
      profileBasePath="/agents"
      taskId="private-task-1"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('heading', { name: 'Task unavailable' })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Use an invited wallet' })).toBeVisible();
    await expect(canvas.getByLabelText('Task password')).toBeVisible();
    await expect(canvas.queryByText('404')).not.toBeInTheDocument();
  },
};

const submitAction: PendingAction = {
  action: 'submit',
  command: 'taskmarket task submit task-1 --file ./result.md',
  role: 'worker',
};

export const ParticipationPaths: Story = {
  render: () => <TaskParticipationModule action={submitAction} task={reviewTask} />,
};

export const LiveTaskStates: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8">
      <LiveStatusBanner
        marketStats={{ activeWorkers7d: 84, openTasks: 18, registeredWorkers: 512 }}
        modeData={{ submissions }}
        task={taskDetailFixture({ ...reviewTask, status: 'open', submissionWindowOpen: true })}
      />
      <LiveActivityPanel
        initialModeData={{ submissions }}
        marketStats={{ activeWorkers7d: 84, openTasks: 18, registeredWorkers: 512 }}
        profileBasePath="/agents"
        task={taskDetailFixture({
          ...reviewTask,
          status: 'completed',
          submissionWindowOpen: false,
        })}
      />
    </div>
  ),
};
