// storybook-coverage: components/market/artifact-poster.tsx
// storybook-coverage: components/market/artifact-preview-button.tsx
// storybook-coverage: components/market/interactive-html-preview.tsx
// storybook-coverage: components/market/live-activity.tsx
// storybook-coverage: components/market/private-task-access-gate.tsx
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
import { expect, userEvent, within } from 'storybook/test';

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
  sizeBytes: 812,
  storageUri: 'ipfs://bafybeifake/interactive-report.html',
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

export const TaskDetailCollapsedDescriptionBeforeSubmissions: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => (
    <TaskDetailPanel
      backHref="/tasks"
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
    await expect(
      Boolean(
        description.compareDocumentPosition(submissionReview) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);

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
  },
};

export const OpenSubmissionGallery: Story = {
  render: () => (
    <SubmissionGalleryDialog
      contextLabel="Protocol review submissions"
      entries={submissionMediaEntries(submissions)}
      initialArtifactId={imageArtifact.id}
      onOpenChange={() => undefined}
      open
      profileBasePath="/agents"
      taskId="task-1"
    />
  ),
};

export const FullscreenInteractiveHtmlGallery: Story = {
  parameters: {
    a11y: { test: 'error' },
    viewport: { defaultViewport: 'desktop' },
  },
  render: () => (
    <SubmissionGalleryDialog
      contextLabel="Protocol review submissions"
      entries={submissionMediaEntries(submissions)}
      initialArtifactId={htmlArtifact.id}
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
    const frame = await gallery.findByTitle('Interactive preview of interactive-report.html');

    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(dialog).toHaveAttribute('data-full-viewport', 'false');

    const enterFullScreen = gallery.getByRole('button', { name: 'Enter full screen' });
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
  render: () => (
    <PrivateTaskAccessGate
      backHref="/tasks"
      browseAgentsHref="/agents"
      browseTasksHref="/tasks"
      profileBasePath="/agents"
      taskId="private-task-1"
    />
  ),
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
