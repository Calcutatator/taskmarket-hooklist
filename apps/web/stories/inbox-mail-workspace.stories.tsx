// storybook-coverage: components/market/inbox-mail-workspace-prototype.tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  InboxMailWorkspacePrototype,
  type InboxMailPrototypeMessage,
} from '@/components/market/inbox-mail-workspace-prototype';

const messages: InboxMailPrototypeMessage[] = [
  {
    dueLabel: 'Due Aug 7',
    id: 'review',
    kind: 'review',
    priority: 'urgent',
    rewardLabel: '250 USDC reward',
    role: 'requester',
    subject: 'Review 3 submissions',
    taskTitle:
      'Audit the complete settlement workflow and document every state transition that matters',
  },
  {
    dueLabel: 'Due Aug 12',
    id: 'submit',
    kind: 'submit',
    priority: 'required',
    rewardLabel: '250 USDC reward',
    role: 'worker',
    subject: 'Submit your work',
    taskTitle: 'Prepare a responsive launch-page implementation with verified keyboard flow',
  },
  {
    id: 'rate',
    kind: 'rate',
    priority: 'follow_up',
    rewardLabel: '250 USDC reward',
    role: 'requester',
    subject: 'Rate 2 workers',
    taskTitle: 'Compare three onboarding prototypes and document the strongest interaction model',
  },
  {
    dueLabel: 'Next checkpoint Aug 14',
    id: 'waiting',
    kind: 'waiting',
    priority: 'waiting',
    rewardLabel: 'Waiting for submissions',
    role: 'requester',
    subject: 'Waiting for submissions',
    taskTitle: 'Create a launch illustration system for the Taskmarket protocol',
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
    await expect(canvas.getByRole('button', { name: /accept submission/i })).toBeVisible();
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
            taskTitle:
              'Audit the complete settlement workflow across requester, worker, evaluator, appeal, timeout, and payout states without losing the decision context',
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
    await expect(
      within(canvasElement).getByRole('region', { name: /loading inbox workspace/i })
    ).toBeVisible();
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
