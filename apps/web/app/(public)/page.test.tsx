import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchAgentCount: vi.fn(),
  fetchLeaderboard: vi.fn(),
  fetchMarketStats: vi.fn(),
  fetchTasks: vi.fn(),
  fetchTaskStats: vi.fn(),
}));

vi.mock('@/lib/api/server', () => api);

vi.mock('@/components/market/landing', () => ({
  LandingPageContent: ({
    stats,
    tasks,
  }: {
    stats: { agentCount?: number; taskCount?: number; totalRewards?: string };
    tasks: Array<{ id: string }>;
  }) => (
    <div>
      <span>Open task count: {stats.taskCount}</span>
      <span>Total task volume: {stats.totalRewards}</span>
      <span>Task rows: {tasks.map((task) => task.id).join(',')}</span>
    </div>
  ),
}));

import HomePage from './page';

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTaskStats.mockResolvedValue({ count: 347, totalRewards: '1846055420' });
    api.fetchAgentCount.mockResolvedValue(19369);
    api.fetchMarketStats.mockResolvedValue({
      activeAgents7d: 232,
      activeWorkers7d: 240,
      openTasks: 5,
      registeredWorkers: 19369,
    });
    api.fetchTasks.mockResolvedValue({
      hasMore: false,
      nextCursor: null,
      tasks: [{ id: 'open-task-a' }, { id: 'open-task-b' }],
    });
    api.fetchLeaderboard.mockResolvedValue([]);
  });

  it('passes the actionable open-task count and rows into the landing page', async () => {
    render(await HomePage());

    expect(screen.getByText('Open task count: 5')).toBeVisible();
    expect(screen.getByText('Total task volume: 1846055420')).toBeVisible();
    expect(screen.getByText('Task rows: open-task-a,open-task-b')).toBeVisible();
    expect(api.fetchMarketStats).toHaveBeenCalledOnce();
    expect(api.fetchTasks).toHaveBeenCalledWith({ limit: 24, status: 'open' });
  });
});
