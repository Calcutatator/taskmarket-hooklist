// storybook-coverage: components/market/inbox-mail-workspace-prototype.tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  InboxMailWorkspacePrototype,
  type InboxMailPrototypeMessage,
} from '@/components/market/inbox-mail-workspace-prototype';

import { addresses, taskFixture } from './fixtures';

const reviewTask = taskFixture({
  description:
    'Audit the complete settlement workflow and document every state transition that matters',
  id: 'task-review',
  requester: addresses.requester,
  requesterPubkey: addresses.requester,
  status: 'pending_approval',
  submissionCount: 3,
});

const messages: InboxMailPrototypeMessage[] = [
  {
    actions: [
      {
        action: 'accept',
        command: 'taskmarket task accept task-review',
        role: 'requester',
      },
      {
        action: 'reject_submission',
        command: 'taskmarket task reject-submission task-review',
        role: 'requester',
      },
    ],
    dueAt: '2026-08-07T00:00:00.000Z',
    id: 'review',
    intent: 'review_work',
    priority: 'urgent',
    progress: { completed: 0, total: 3 },
    role: 'requester',
    task: reviewTask,
  },
  {
    actions: [
      {
        action: 'submit',
        command: 'taskmarket task submit task-delivery',
        role: 'worker',
      },
    ],
    dueAt: '2026-08-12T00:00:00.000Z',
    id: 'submit',
    intent: 'submit_work',
    priority: 'required',
    progress: null,
    role: 'worker',
    task: taskFixture({
      claimedBy: addresses.worker,
      description: 'Prepare a responsive launch-page implementation with verified keyboard flow',
      id: 'task-delivery',
      mode: 'claim',
      status: 'claimed',
    }),
  },
  {
    actions: [
      {
        action: 'rate',
        command: 'taskmarket task rate task-rating',
        role: 'requester',
        targetWorker: addresses.worker,
      },
    ],
    dueAt: null,
    id: 'rate',
    intent: 'rate_workers',
    priority: 'follow_up',
    progress: { completed: 1, total: 3 },
    role: 'requester',
    task: taskFixture({
      description:
        'Compare three onboarding prototypes and document the strongest interaction model',
      id: 'task-rating',
      phase: 'resolved',
      status: 'completed',
    }),
  },
  {
    dueAt: '2026-08-14T00:00:00.000Z',
    id: 'waiting',
    reason: 'waiting_for_submissions',
    role: 'requester',
    task: taskFixture({
      description: 'Create a launch illustration system for the Taskmarket protocol',
      id: 'task-waiting',
    }),
  },
];

const meta = {
  args: { messages },
  component: InboxMailWorkspacePrototype,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
  title: 'Product/Action Inbox/Mail workspace prototype',
} satisfies Meta<typeof InboxMailWorkspacePrototype>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewSelected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Review 3 submissions' })).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: /view evidence/i })).toHaveLength(3);
    await expect(canvas.getByRole('button', { name: /select a submission first/i })).toBeDisabled();

    const firstSubmission = canvas.getByRole('button', {
      name: /select submission from 0x7421/i,
    });
    await userEvent.click(firstSubmission);

    await expect(firstSubmission).toHaveAttribute('aria-pressed', 'true');
    await expect(
      canvas.getByRole('button', { name: /accept 0x7421.*and release 250 usdc/i })
    ).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /reject 0x7421/i })).toBeEnabled();
  },
};

export const SubmitSelected: Story = {
  args: { initialSelectedId: 'submit' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Submit your work' })).toBeVisible();
    await expect(canvas.getByText('Add deliverables')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /submit work/i })).toBeVisible();
  },
};

export const RatingFollowUpSelected: Story = {
  args: { initialSelectedId: 'rate' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Rate 2 workers' })).toBeVisible();
    await expect(canvas.getByText('Rating progress')).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: /rate worker/i })).toHaveLength(2);
  },
};

export const ReviewAndSelectSubmission: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Review 3 submissions' })).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: /submit your work/i }));

    await expect(canvas.getByRole('heading', { name: 'Submit your work' })).toBeVisible();
    await expect(canvas.getByText('Add deliverables')).toBeVisible();
  },
};

export const MobileSelectAndReturn: Story = {
  args: { startOnList: true },
  parameters: { viewport: { defaultViewport: 'mobile' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const submitMessage = canvas.getByRole('button', { name: /submit your work/i });

    await userEvent.click(submitMessage);
    await expect(canvas.getByRole('heading', { name: 'Submit your work' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /back to inbox/i })).toHaveFocus();

    await userEvent.click(canvas.getByRole('button', { name: /back to inbox/i }));
    await expect(canvas.getByRole('navigation', { name: /inbox messages/i })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /submit your work/i })).toHaveFocus();
  },
};

export const SwitchToWaitingView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /waiting 1/i }));

    await expect(canvas.getByText('No action is needed from you right now.')).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: /create a launch illustration system/i })
    ).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /review 3 submissions/i })).toBeNull();
  },
};

export const LongContent: Story = {
  args: {
    messages: messages.map((message) =>
      message.id === 'review'
        ? {
            ...message,
            task: {
              ...message.task,
              description:
                'Audit the complete settlement workflow across requester, worker, evaluator, appeal, timeout, and payout states without losing the decision context',
            },
          }
        : message
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const detail = within(canvas.getByRole('article', { name: 'Review 3 submissions' }));
    await expect(
      detail.getByText(/audit the complete settlement workflow across requester/i)
    ).toBeVisible();
  },
};

export const LongEvidence: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'complete-state-transition-audit-with-requester-worker-evaluator-and-dispute-annotations.pdf'
      )
    ).toBeVisible();
  },
};

export const DarkTheme: Story = {
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: 'Review 3 submissions' })
    ).toBeVisible();
  },
};

export const LightTheme: Story = {
  globals: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Review 3 submissions' })).toBeVisible();
    await expect(canvas.getByRole('navigation', { name: /inbox messages/i })).toBeVisible();
  },
};

export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvasElement }) => {
    const skeleton = canvasElement.querySelector<HTMLElement>('[data-slot="skeleton"]');
    if (!skeleton) throw new Error('Expected the loading state to render a skeleton');
    await expect(
      within(canvasElement).getByRole('region', { name: /loading inbox workspace/i })
    ).toBeVisible();
    await expect(skeleton).toHaveClass('motion-reduce:animate-none');
  },
};

export const Disconnected: Story = {
  args: { status: 'disconnected' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: /connect to view your inbox/i })
    ).toBeVisible();
  },
};

export const ErrorAndRetry: Story = {
  args: { status: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent(/inbox unavailable/i);
    await userEvent.click(canvas.getByRole('button', { name: /retry/i }));
    await expect(canvas.getByRole('heading', { name: 'Review 3 submissions' })).toBeVisible();
  },
};

export const AllCaughtUp: Story = {
  args: { messages: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: /all caught up/i })
    ).toBeVisible();
  },
};
