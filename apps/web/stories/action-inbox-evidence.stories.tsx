import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { VerdictEvidencePanel } from '@/components/market/verdict-evidence-panel';

import { addresses, taskDetailFixture } from './fixtures';

const recordedVerdict = taskDetailFixture({
  appealDeadline: '2026-08-08T12:00:00.000Z',
  disputeResolver: addresses.workerB,
  evaluator: addresses.evaluator,
  evaluatorDeadline: '2026-08-07T12:00:00.000Z',
  status: 'appealing',
  verdictConfidence: 875,
  verdictEvidenceHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  verdictScore: 920,
  verdictType: 'APPROVE',
});

const meta = {
  component: VerdictEvidencePanel,
  parameters: {
    a11y: { test: 'error' },
    layout: 'padded',
  },
  title: 'Market/Action Inbox/Verdict Evidence',
} satisfies Meta<typeof VerdictEvidencePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PublicRecordedVerdict: Story = {
  args: { task: recordedVerdict },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('region', { name: /verdict and decision evidence/i })
    ).toHaveTextContent('Approved');
  },
};

export const PendingVerdict: Story = {
  args: {
    forceVisible: true,
    task: taskDetailFixture({
      evaluator: addresses.evaluator,
      evaluatorDeadline: '2026-08-07T12:00:00.000Z',
      status: 'review',
    }),
  },
};

export const MissingOptionalMetadata: Story = {
  args: {
    forceVisible: true,
    task: taskDetailFixture({ status: 'appealing', verdictType: 'REJECT' }),
  },
};

export const LongEvidenceHash: Story = {
  args: { task: recordedVerdict },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const RestrictedEvidenceOmitted: Story = {
  args: {
    forceVisible: true,
    task: taskDetailFixture({
      appealDeadline: '2026-08-08T12:00:00.000Z',
      status: 'appealing',
      verdictConfidence: 875,
      verdictEvidenceHash: null,
      verdictScore: 920,
      verdictType: 'PARTIAL',
    }),
  },
};

export const DarkTheme: Story = {
  args: { task: recordedVerdict },
  globals: { theme: 'dark' },
};
