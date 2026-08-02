// storybook-coverage: components/market/task-drop-subscribe-form.tsx
// storybook-coverage: components/market/task-drops/drop-page/drop-clock.tsx
// storybook-coverage: components/market/task-drops/drop-page/drop-lifecycle-refresh.tsx
// storybook-coverage: components/market/task-drops/drop-page/drop-page-view.tsx
// storybook-coverage: components/market/task-drops/task-drop-detail.tsx
// storybook-coverage: components/taskdrop/copy-command.tsx
// storybook-coverage: components/taskdrop/drop-alerts-form.tsx
// storybook-coverage: components/taskdrop/drop-alerts-inline-form.tsx
// storybook-coverage: components/taskdrop/falling-tiles.tsx
// storybook-coverage: components/taskdrop/progress-rail.tsx
// storybook-coverage: components/taskdrop/proof-carousel.tsx
// storybook-coverage: components/taskdrop/scroll-snap-shell.tsx

import type { TaskDropPageData } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { TaskDropSubscribeForm } from '@/components/market/task-drop-subscribe-form';
import { DropPageView } from '@/components/market/task-drops/drop-page/drop-page-view';
import { sampleDrop, sampleDropTasks } from '@/components/market/task-drops/drop-page/sample-drop';
import { TaskDropDetail } from '@/components/market/task-drops/task-drop-detail';
import { CopyCommand } from '@/components/taskdrop/copy-command';
import { DropAlertsForm } from '@/components/taskdrop/drop-alerts-form';
import { DropAlertsInlineForm } from '@/components/taskdrop/drop-alerts-inline-form';
import { FallingTiles } from '@/components/taskdrop/falling-tiles';
import { ProgressRail } from '@/components/taskdrop/progress-rail';
import { ProofCarousel } from '@/components/taskdrop/proof-carousel';
import { ScrollSnapShell } from '@/components/taskdrop/scroll-snap-shell';

function TaskDropCatalog() {
  return <div>Task Drop campaign surfaces</div>;
}

const meta = {
  component: TaskDropCatalog,
  parameters: { layout: 'fullscreen' },
  title: 'Product/Task Drops',
} satisfies Meta<typeof TaskDropCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const detailData: TaskDropPageData = {
  drop: {
    announcedAt: '2026-07-20T00:00:00.000Z',
    createdAt: '2026-07-19T00:00:00.000Z',
    description: 'Funded tasks exploring useful tools for public infrastructure.',
    id: 'civic-tools',
    isOfficial: true,
    name: 'Civic Tools',
    officialWalletAddress: '0x1111111111111111111111111111111111111111',
    ownerAddress: '0x1111111111111111111111111111111111111111',
  },
  tasks: [
    {
      createdAt: '2026-07-20T00:00:00.000Z',
      description: 'Map an accessible public service flow\nInclude source files.',
      expiryTime: '2026-08-25T00:00:00.000Z',
      id: 'available-task',
      mode: 'bounty',
      reward: '12500000',
      status: 'open',
      tags: ['research', 'accessibility'],
    },
    {
      createdAt: '2026-07-20T00:00:00.000Z',
      description: 'Prototype a resident feedback tool',
      expiryTime: '2026-07-23T00:00:00.000Z',
      id: 'in-progress-task',
      mode: 'claim',
      reward: '5000000',
      status: 'pending_approval',
      tags: [],
    },
    {
      createdAt: '2026-07-20T00:00:00.000Z',
      description: 'Document a community data standard',
      expiryTime: '2026-07-22T00:00:00.000Z',
      id: 'completed-task',
      mode: 'benchmark',
      reward: '2500000',
      status: 'completed',
      tags: ['documentation'],
    },
  ],
};

export const LiveCampaign: Story = {
  render: () => <DropPageView drop={sampleDrop} tasks={sampleDropTasks('live')} />,
};

export const JudgingCampaign: Story = {
  render: () => <DropPageView drop={sampleDrop} tasks={sampleDropTasks('judging')} />,
};

export const FinishedCampaign: Story = {
  render: () => (
    <DropPageView drop={sampleDrop} showLiveDropLink tasks={sampleDropTasks('finished')} />
  ),
};

export const CommunityDropDirectoryDetail: Story = {
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <TaskDropDetail
        data={detailData}
        now={new Date('2026-08-02T00:00:00.000Z')}
        taskHrefBase="/tasks"
      />
    </div>
  ),
};

export const SubscriptionFormVariants: Story = {
  render: () => (
    <div className="mx-auto grid max-w-4xl gap-8 p-6 md:grid-cols-2">
      <TaskDropSubscribeForm isOfficial taskDropId="official-2026" />
      <TaskDropSubscribeForm isOfficial={false} taskDropId="community-research" />
      <DropAlertsForm />
      <DropAlertsInlineForm />
    </div>
  ),
};

export const CampaignBuildingBlocks: Story = {
  render: () => (
    <ScrollSnapShell enabled={false}>
      <div className="taskdrop relative grid min-h-screen gap-10 overflow-hidden bg-background p-8 text-foreground">
        <FallingTiles />
        <div className="relative z-10 grid gap-10">
          <ProgressRail />
          <ProofCarousel />
          <div className="flex max-w-2xl items-center gap-3 rounded-xl bg-card p-4">
            <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm">
              npx skills add taskmarket
            </code>
            <CopyCommand command="npx skills add taskmarket" />
          </div>
        </div>
      </div>
    </ScrollSnapShell>
  ),
};
