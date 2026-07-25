import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchActivityFeed: vi.fn(),
  fetchActivityHeatmap: vi.fn(),
  fetchAgentCount: vi.fn(),
  fetchBreakdowns: vi.fn(),
  fetchLeaderboard: vi.fn(),
  fetchMarketStats: vi.fn(),
  fetchPlatformTimeSeries: vi.fn(),
  fetchTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
}));

vi.mock('@/lib/api/server', () => api);

vi.mock('@/components/market/dashboard-scope', () => ({
  DashboardScope: ({
    marketContent,
    marketTitle,
  }: {
    marketContent: React.ReactNode;
    marketTitle: string;
  }) => (
    <section>
      <h1>{marketTitle}</h1>
      {marketContent}
    </section>
  ),
}));

vi.mock('@/components/section-cards', () => ({
  SectionCards: ({ openTaskCount }: { openTaskCount: number }) => (
    <div>Open task metric: {openTaskCount}</div>
  ),
}));

vi.mock('@/components/market/dashboard-activity-chart', () => ({
  DashboardActivityChart: () => <div>Activity trend</div>,
}));
vi.mock('@/components/market/dashboard-activity-feed', () => ({
  DashboardActivityFeed: () => <div>Activity feed</div>,
}));
vi.mock('@/components/market/dashboard-distribution-chart', () => ({
  DashboardDistributionChart: () => <div>Task distribution</div>,
}));
vi.mock('@/components/market/dashboard-heatmap', () => ({
  DashboardHeatmap: () => <div>Activity heat map</div>,
}));
vi.mock('@/components/market/agents', () => ({
  AgentTable: () => <div>Agent rows</div>,
}));
vi.mock('@/components/market/tasks', () => ({
  TaskTable: () => <div>Task rows</div>,
}));
vi.mock('@/components/market/promo-banner', () => ({
  PromoBanner: () => <div>Promotion</div>,
}));

import DashboardPage from './page';

function seedSuccessfulResponses() {
  api.fetchTaskStats.mockResolvedValue({ count: 21, totalRewards: '45000000' });
  api.fetchAgentCount.mockResolvedValue(12);
  api.fetchMarketStats.mockResolvedValue({
    activeAgents7d: 7,
    activeWorkers7d: 7,
    openTasks: 99,
    registeredWorkers: 12,
  });
  api.fetchPlatformTimeSeries.mockResolvedValue([]);
  api.fetchBreakdowns.mockResolvedValue({ actorType: [], mode: [], status: [] });
  api.fetchActivityFeed.mockResolvedValue({ items: [], nextCursor: null });
  api.fetchActivityHeatmap.mockResolvedValue({
    cells: [],
    colKeys: [],
    maxCount: 0,
    rowKeys: [],
  });
  api.fetchTasks.mockResolvedValue({ nextCursor: null, tasks: [] });
  api.fetchLeaderboard.mockResolvedValue([]);
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSuccessfulResponses();
  });

  it('renders the concise overview and uses the authoritative open-task metric', async () => {
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Marketplace overview' })).toBeVisible();
    expect(screen.getByText('Open task metric: 99')).toBeVisible();
    expect(api.fetchTaskStats).toHaveBeenCalledOnce();
    expect(api.fetchAgentCount).toHaveBeenCalledOnce();
    expect(api.fetchMarketStats).toHaveBeenCalledOnce();
    expect(api.fetchPlatformTimeSeries).toHaveBeenCalledOnce();
    expect(api.fetchTasks).not.toHaveBeenCalled();
    expect(api.fetchLeaderboard).not.toHaveBeenCalled();
  });

  it('fetches and renders only marketplace activity for the activity section', async () => {
    render(
      await DashboardPage({
        searchParams: Promise.resolve({ section: 'activity' }),
      })
    );

    expect(screen.getByRole('heading', { name: 'Marketplace activity' })).toBeVisible();
    expect(screen.getByText('Activity trend')).toBeVisible();
    expect(screen.getByText('Activity feed')).toBeVisible();
    expect(api.fetchPlatformTimeSeries).toHaveBeenCalledOnce();
    expect(api.fetchBreakdowns).toHaveBeenCalledOnce();
    expect(api.fetchActivityFeed).toHaveBeenCalledWith({ limit: 12 });
    expect(api.fetchActivityHeatmap).toHaveBeenCalledOnce();
    expect(api.fetchTaskStats).not.toHaveBeenCalled();
    expect(api.fetchTasks).not.toHaveBeenCalled();
  });

  it('limits task and agent sections to compact previews', async () => {
    const tasks = await DashboardPage({
      searchParams: Promise.resolve({ section: 'tasks' }),
    });
    render(tasks);

    expect(screen.getByRole('heading', { name: 'Latest tasks' })).toBeVisible();
    expect(api.fetchTasks).toHaveBeenCalledWith({ limit: 6 });
    expect(api.fetchLeaderboard).not.toHaveBeenCalled();

    vi.clearAllMocks();
    seedSuccessfulResponses();

    render(
      await DashboardPage({
        searchParams: Promise.resolve({ section: 'agents' }),
      })
    );

    expect(screen.getByRole('heading', { name: 'Reputation leaders' })).toBeVisible();
    expect(api.fetchLeaderboard).toHaveBeenCalledWith({ limit: 5, sort: 'reputation' });
    expect(api.fetchTasks).not.toHaveBeenCalled();
  });

  it('renders an explicit recoverable state when activity data cannot load', async () => {
    api.fetchActivityFeed.mockRejectedValue(new Error('offline'));

    render(
      await DashboardPage({
        searchParams: Promise.resolve({ section: 'activity' }),
      })
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load recent marketplace activity.'
    );
    expect(screen.queryByText('Activity feed')).not.toBeInTheDocument();
  });
});
