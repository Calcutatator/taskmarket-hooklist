// storybook-coverage: components/market/market-liquidity.tsx
// storybook-coverage: components/market/task-cover.tsx
// storybook-coverage: components/market/task-drops/task-drop-card.tsx
// storybook-coverage: components/market/task-drops/task-drop-directory.tsx
// storybook-coverage: components/market/task-thumbnail.tsx
// storybook-coverage: components/market/tasks.tsx
// storybook-coverage: components/market/unlisted-badge.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { MarketLiquidityPanel, MarketLiquidityStrip } from '@/components/market/market-liquidity';
import { TaskCover } from '@/components/market/task-cover';
import { TaskDropCard } from '@/components/market/task-drops/task-drop-card';
import { TaskDropDirectory } from '@/components/market/task-drops/task-drop-directory';
import { TaskViewToggle } from '@/components/market/task-thumbnail';
import { TaskFilterRail, TaskTable } from '@/components/market/tasks';
import { TaskVisibilityBadge, UnlistedBadge } from '@/components/market/unlisted-badge';

import { addresses, taskDropItems, taskFixture } from './fixtures';

function TaskSurfaceCatalog() {
  return <div>Taskmarket task surfaces</div>;
}

const meta = {
  component: TaskSurfaceCatalog,
  title: 'Product/Tasks and drops',
} satisfies Meta<typeof TaskSurfaceCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const taskModes = [
  taskFixture({ id: 'bounty', mode: 'bounty', reward: '250000000' }),
  taskFixture({
    id: 'claim',
    mode: 'claim',
    claimedAt: '2026-08-02T02:00:00.000Z',
    claimedBy: addresses.worker,
    reward: '75000000',
    status: 'claimed',
  }),
  taskFixture({
    id: 'pitch',
    mode: 'pitch',
    pitchCount: 4,
    pitchDeadline: '2026-08-05T01:00:00.000Z',
    reward: '500000000',
  }),
  taskFixture({
    auctionBidCount: 7,
    auctionType: 'english',
    bidDeadline: '2026-08-04T01:00:00.000Z',
    id: 'auction',
    maxPrice: '400000000',
    mode: 'auction',
    reward: '0',
  }),
  taskFixture({
    id: 'benchmark',
    metricDescription: 'F1 score on the held-out evaluation set',
    metricTarget: '0.92',
    mode: 'benchmark',
    reward: '1000000000',
  }),
];

const statusTasks = [
  taskFixture({ id: 'open', status: 'open' }),
  taskFixture({
    claimedAt: '2026-08-02T02:00:00.000Z',
    claimedBy: addresses.worker,
    id: 'claimed',
    status: 'claimed',
  }),
  taskFixture({ id: 'selected', status: 'worker_selected', submissionCount: 1 }),
  taskFixture({ id: 'pending', status: 'pending_approval', submissionCount: 3 }),
  taskFixture({ id: 'completed', status: 'completed', submissionWindowOpen: false }),
  taskFixture({ id: 'review', status: 'review', submissionWindowOpen: false }),
  taskFixture({ id: 'appealing', status: 'appealing', submissionWindowOpen: false }),
  taskFixture({ id: 'cancelled', status: 'cancelled', submissionWindowOpen: false }),
  taskFixture({ id: 'expired', status: 'expired', submissionWindowOpen: false }),
  taskFixture({ id: 'disputed', status: 'disputed', submissionWindowOpen: false }),
];

export const TaskModeTable: Story = {
  render: () => <TaskTable detailBasePath="/tasks" tasks={taskModes} />,
};

export const TaskStatusTable: Story = {
  render: () => <TaskTable detailBasePath="/tasks" tasks={statusTasks} />,
};

export const TaskTableStates: Story = {
  render: () => (
    <div className="grid gap-8">
      <TaskTable isLoading tasks={[]} />
      <TaskTable errorMessage="Tasks could not be loaded." tasks={[]} />
      <TaskTable tasks={[]} />
      <TaskTable hasActiveFilters tasks={[]} />
    </div>
  ),
};

export const GalleryCoversByMode: Story = {
  render: () => <TaskTable detailBasePath="/tasks" tasks={taskModes} view="gallery" />,
  parameters: {
    viewport: { defaultViewport: 'desktop' },
  },
};

export const CoverDataBoundaries: Story = {
  render: () => (
    <div className="grid max-w-7xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <TaskCover task={taskFixture({ id: 'short', description: 'Short task' })} />
      <TaskCover
        task={taskFixture({
          description:
            'A deliberately long user-provided task description that verifies the gallery title wraps cleanly without pushing reward information outside the card surface',
          id: 'long-description',
          reward: '999999999999',
          tags: ['long-tag-value', 'design', 'research', 'quality-assurance'],
        })}
      />
      <TaskCover
        task={taskFixture({
          id: 'unlisted',
          submissionVisibility: 'never',
          taskVisibility: 'unlisted',
        })}
      />
      <TaskCover
        task={taskFixture({
          id: 'private',
          submissionVisibility: 'winner_only',
          taskVisibility: 'private',
        })}
      />
    </div>
  ),
};

export const FiltersAndViewControls: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8 md:grid-cols-[18rem_minmax(0,1fr)]">
      <TaskFilterRail
        maxReward="500"
        minReward="25"
        selectedActor="agent"
        selectedMode="auction"
        selectedSort="reward_desc"
        selectedStatus="open"
        tags="research, design"
      />
      <div className="grid content-start gap-6">
        <TaskViewToggle
          currentFilters={{ mode: 'auction', sort: 'reward_desc', status: 'open' }}
          view="table"
        />
        <TaskViewToggle
          currentFilters={{ mode: 'auction', sort: 'reward_desc', status: 'open' }}
          presentation="mobile"
          view="gallery"
        />
      </div>
    </div>
  ),
};

export const VisibilityBadges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <UnlistedBadge />
      <UnlistedBadge compact />
      <UnlistedBadge withTooltip />
      <TaskVisibilityBadge visibility="private" />
      <TaskVisibilityBadge visibility="private" withTooltip />
    </div>
  ),
};

export const DropCards: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-5 md:grid-cols-2">
      {taskDropItems.map((item) => (
        <TaskDropCard item={item} key={item.drop.id} />
      ))}
    </div>
  ),
};

export const DropDirectoryStates: Story = {
  render: () => (
    <div className="grid gap-12">
      <TaskDropDirectory items={taskDropItems} nextCursor="next-page" />
      <TaskDropDirectory items={[]} nextCursor={null} />
      <TaskDropDirectory
        errorMessage="The Task Drop service timed out."
        items={[]}
        nextCursor={null}
      />
    </div>
  ),
};

const activeMarket = {
  activeWorkers7d: 84,
  openTasks: 18,
  registeredWorkers: 512,
};

export const MarketLiquidityStates: Story = {
  render: () => (
    <div className="grid max-w-4xl gap-8">
      <MarketLiquidityStrip stats={activeMarket} />
      <MarketLiquidityPanel stats={activeMarket} />
      <MarketLiquidityStrip stats={{ ...activeMarket, activeWorkers7d: 1, registeredWorkers: 1 }} />
      <MarketLiquidityPanel stats={{ ...activeMarket, activeWorkers7d: 0, openTasks: 0 }} />
    </div>
  ),
};
