// storybook-coverage: components/market/agent-avatar.tsx
// storybook-coverage: components/market/agent-identity-card.tsx
// storybook-coverage: components/market/agent-performance-chart.tsx
// storybook-coverage: components/market/agent-ratings-histogram.tsx
// storybook-coverage: components/market/agent-resources.tsx
// storybook-coverage: components/market/agents.tsx
// storybook-coverage: components/market/copy-button.tsx
// storybook-coverage: components/market/dashboard-activity-chart.tsx
// storybook-coverage: components/market/dashboard-activity-feed.tsx
// storybook-coverage: components/market/dashboard-distribution-chart.tsx
// storybook-coverage: components/market/dashboard-heatmap.tsx
// storybook-coverage: components/market/dashboard-scope.tsx
// storybook-coverage: components/market/dashboard-section-tabs.tsx
// storybook-coverage: components/market/dashboard-you-view.tsx
// storybook-coverage: components/market/dreams-reward-disclosure.tsx
// storybook-coverage: components/market/info-tooltip.tsx
// storybook-coverage: components/market/promo-banner.tsx
// storybook-coverage: components/market/promo-carousel.tsx
// storybook-coverage: components/market/promo-side-card.tsx
// storybook-coverage: components/market/protocol-dashboard.tsx
// storybook-coverage: components/market/protocol.tsx
// storybook-coverage: components/market/skill-install-menu.tsx
// storybook-coverage: components/market/skill-install-snippet.tsx
// storybook-coverage: components/market/task-types.tsx

import type {
  ActivityFeedResponse,
  ActivityHeatmapResponse,
  AgentTimeSeriesResponse,
  BreakdownsResponse,
  LeaderboardEntry,
  PlatformTimeSeriesResponse,
} from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AgentAvatar } from '@/components/market/agent-avatar';
import { AgentIdentityCard } from '@/components/market/agent-identity-card';
import { AgentPerformanceChart } from '@/components/market/agent-performance-chart';
import { AgentRatingsHistogram } from '@/components/market/agent-ratings-histogram';
import { AgentResourcesContent } from '@/components/market/agent-resources';
import { AgentLeaderboardPanel, AgentTable } from '@/components/market/agents';
import { CopyButton } from '@/components/market/copy-button';
import { DashboardActivityChart } from '@/components/market/dashboard-activity-chart';
import { DashboardActivityFeed } from '@/components/market/dashboard-activity-feed';
import { DashboardDistributionChart } from '@/components/market/dashboard-distribution-chart';
import { DashboardHeatmap } from '@/components/market/dashboard-heatmap';
import { DashboardScope } from '@/components/market/dashboard-scope';
import { DashboardSectionTabs } from '@/components/market/dashboard-section-tabs';
import { DreamsRewardDisclosure } from '@/components/market/dreams-reward-disclosure';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { PromoBanner } from '@/components/market/promo-banner';
import { PromoCarousel } from '@/components/market/promo-carousel';
import { PromoSideCard } from '@/components/market/promo-side-card';
import { DashboardProtocolContent } from '@/components/market/protocol-dashboard';
import { ProtocolContent } from '@/components/market/protocol';
import { SkillInstallMenu } from '@/components/market/skill-install-menu';
import { SkillInstallSnippet } from '@/components/market/skill-install-snippet';
import { TaskTypesContent } from '@/components/market/task-types';
import { Card, CardContent } from '@/components/ui/card';
import { CAROUSEL_SLOTS, SIDE_CARD_SLOTS, type PromoSlot } from '@/lib/market/promo-slots';
import { skillInstallCommands } from '@/lib/skill';

import { addresses } from './fixtures';

function DataDisplayCatalog() {
  return <div>Taskmarket data displays</div>;
}

const meta = {
  component: DataDisplayCatalog,
  title: 'Product/Data displays',
} satisfies Meta<typeof DataDisplayCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const agents: LeaderboardEntry[] = [
  {
    actorType: 'agent',
    address: addresses.worker,
    agentId: '42',
    averageRating: 4.9,
    completedTasks: 128,
    credibility: 952,
    emailAddress: null,
    rank: 1,
    skills: ['research', 'frontend', 'evaluation'],
    totalEarnings: '18425000000',
  },
  {
    actorType: 'agent',
    address: addresses.workerB,
    agentId: null,
    averageRating: 4.3,
    completedTasks: 44,
    credibility: 812,
    emailAddress: 'worker@example.com',
    rank: 2,
    skills: ['solidity', 'security'],
    totalEarnings: '7210000000',
  },
  {
    actorType: 'human',
    address: addresses.evaluator,
    agentId: null,
    averageRating: 0,
    completedTasks: 0,
    credibility: 0,
    emailAddress: null,
    rank: 3,
    skills: [],
    totalEarnings: '0',
  },
];

const agentSeries: AgentTimeSeriesResponse = [
  {
    activityCount: 4,
    avgRating: 88,
    bucket: '2026-06-01',
    cumulativeEarnings: '120000000',
    earnings: '120000000',
    ratingsCount: 2,
    tasksCompleted: 2,
  },
  {
    activityCount: 8,
    avgRating: 92,
    bucket: '2026-06-08',
    cumulativeEarnings: '340000000',
    earnings: '220000000',
    ratingsCount: 3,
    tasksCompleted: 3,
  },
  {
    activityCount: 10,
    avgRating: null,
    bucket: '2026-06-15',
    cumulativeEarnings: '510000000',
    earnings: '170000000',
    ratingsCount: 0,
    tasksCompleted: 2,
  },
  {
    activityCount: 12,
    avgRating: 96,
    bucket: '2026-06-22',
    cumulativeEarnings: '860000000',
    earnings: '350000000',
    ratingsCount: 4,
    tasksCompleted: 4,
  },
];

const activitySeries: PlatformTimeSeriesResponse = [
  {
    activeAgents: 21,
    bucket: '2026-07-29',
    completedTasks: 8,
    newAgents: 4,
    rewardVolume: '280000000',
    tasksCreated: 12,
  },
  {
    activeAgents: 26,
    bucket: '2026-07-30',
    completedTasks: 11,
    newAgents: 3,
    rewardVolume: '410000000',
    tasksCreated: 18,
  },
  {
    activeAgents: 31,
    bucket: '2026-07-31',
    completedTasks: 15,
    newAgents: 5,
    rewardVolume: '520000000',
    tasksCreated: 22,
  },
  {
    activeAgents: 38,
    bucket: '2026-08-01',
    completedTasks: 19,
    newAgents: 6,
    rewardVolume: '680000000',
    tasksCreated: 29,
  },
];

const breakdowns: BreakdownsResponse = {
  actorType: [
    { actorType: 'agent', count: 84 },
    { actorType: 'human', count: 12 },
  ],
  mode: [
    { count: 52, mode: 'bounty' },
    { count: 24, mode: 'auction' },
    { count: 12, mode: 'pitch' },
    { count: 8, mode: 'benchmark' },
  ],
  status: [
    { count: 32, status: 'open' },
    { count: 24, status: 'claimed' },
    { count: 31, status: 'completed' },
    { count: 5, status: 'disputed' },
    { count: 4, status: 'expired' },
  ],
};

const heatmap: ActivityHeatmapResponse = {
  cells: [
    { col: '2026-07-29', count: 3, row: 'bounty', volume: '40000000' },
    { col: '2026-07-30', count: 8, row: 'bounty', volume: '170000000' },
    { col: '2026-07-31', count: 5, row: 'auction', volume: '220000000' },
    { col: '2026-08-01', count: 12, row: 'pitch', volume: '460000000' },
  ],
  colKeys: ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'],
  maxCount: 12,
  rowKeys: ['bounty', 'auction', 'pitch'],
};

const feed: ActivityFeedResponse = {
  items: [
    {
      actor: addresses.requester,
      actorType: 'human',
      amount: '250000000',
      rating: null,
      taskId: 'task-1',
      taskTitle: 'Evaluate protocol documentation',
      timestamp: '2026-08-02T00:59:00.000Z',
      type: 'task_created',
    },
    {
      actor: addresses.worker,
      actorType: 'agent',
      amount: null,
      rating: null,
      taskId: 'task-2',
      taskTitle: 'Build a Storybook component library',
      timestamp: '2026-08-02T00:54:00.000Z',
      type: 'task_submitted',
    },
    {
      actor: addresses.evaluator,
      actorType: 'human',
      amount: null,
      rating: 96,
      taskId: 'task-3',
      taskTitle: null,
      timestamp: '2026-08-02T00:40:00.000Z',
      type: 'task_rated',
    },
  ],
  nextCursor: null,
};

export const AgentAvatarMatrix: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-8">
      <AgentAvatar address={addresses.worker} agentId="42" size="sm" />
      <AgentAvatar address={addresses.workerB} agentId="731" size="md" />
      <AgentAvatar address={addresses.evaluator} size="lg" />
    </div>
  ),
};

export const AgentTables: Story = {
  render: () => (
    <div className="grid gap-8">
      <AgentTable agents={agents} />
      <AgentTable agents={agents} variant="leaderboard" />
      <AgentTable agents={[]} />
    </div>
  ),
};

export const LeaderboardWithFilters: Story = {
  render: () => (
    <AgentLeaderboardPanel
      agents={agents}
      hasNextPage
      hasPrevPage={false}
      page={1}
      pageSize={20}
      sort="reputation"
    />
  ),
};

export const AgentPerformanceStates: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8 md:grid-cols-2">
      <AgentPerformanceChart address={addresses.worker} initialData={agentSeries} />
      <AgentRatingsHistogram
        ratings={[0, 19, 20, 42, 58, 63, 80, 95, 100].map((rating) => ({ rating }))}
      />
      <AgentRatingsHistogram ratings={[]} />
      <AgentIdentityCard />
    </div>
  ),
};

export const DashboardCharts: Story = {
  render: () => (
    <div className="grid max-w-7xl gap-6 md:grid-cols-2">
      <DashboardActivityChart initialData={activitySeries} />
      <DashboardDistributionChart initialData={breakdowns} />
      <DashboardHeatmap initialData={heatmap} />
      <DashboardActivityFeed initialData={feed} />
    </div>
  ),
};

export const DashboardNavigationStates: Story = {
  render: () => (
    <div className="grid gap-8">
      {(['overview', 'activity', 'tasks', 'agents'] as const).map((section) => (
        <DashboardSectionTabs key={section} section={section} />
      ))}
      <DashboardScope
        marketContent={
          <Card>
            <CardContent>Server-rendered marketplace content</CardContent>
          </Card>
        }
      />
    </div>
  ),
};

const promoSlots: PromoSlot[] = [
  {
    accent: 'pink',
    active: true,
    body: 'An internal destination.',
    ctaLabel: 'Browse tasks',
    href: '/tasks',
    id: 'internal',
    title: 'Internal link',
  },
  {
    accent: 'green',
    active: true,
    body: 'An external destination.',
    ctaLabel: 'Read docs',
    href: 'https://docs.taskmarket.dev',
    id: 'external',
    title: 'External link',
  },
  {
    accent: 'cream',
    active: true,
    body: 'A destination that has not shipped.',
    ctaLabel: 'Join list',
    href: '#',
    id: 'soon',
    title: 'Coming soon',
  },
  {
    active: false,
    body: 'This should remain hidden.',
    ctaLabel: 'Hidden',
    href: '#',
    id: 'inactive',
    title: 'Inactive slot',
  },
];

export const PromotionVariants: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8">
      <PromoBanner slots={promoSlots} />
      <PromoCarousel slots={[...promoSlots, ...CAROUSEL_SLOTS]} />
      <PromoSideCard className="max-w-sm" slots={[...promoSlots, ...SIDE_CARD_SLOTS]} />
    </div>
  ),
};

export const InstallControls: Story = {
  render: () => (
    <div className="grid max-w-4xl gap-8">
      <SkillInstallSnippet commands={skillInstallCommands()} />
      <SkillInstallMenu />
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">0x1111111111111111111111111111111111111111</span>
        <CopyButton label="Copy address" text={addresses.requester} />
        <InfoTooltip label="This is the requester settlement address.">
          Why this address?
        </InfoTooltip>
        <DreamsRewardDisclosure />
      </div>
    </div>
  ),
};

export const ProtocolPages: Story = {
  render: () => (
    <div className="grid gap-16">
      <ProtocolContent />
      <DashboardProtocolContent />
      <TaskTypesContent />
    </div>
  ),
};

export const AgentSetupPage: Story = {
  render: () => <AgentResourcesContent />,
  parameters: { layout: 'fullscreen' },
};
