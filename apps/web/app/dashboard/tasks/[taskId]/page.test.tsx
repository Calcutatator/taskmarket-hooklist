import type { TaskDetailResponse } from '@taskmarket/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMarketStats, fetchTask, fetchTaskModeData } = vi.hoisted(() => ({
  fetchMarketStats: vi.fn(),
  fetchTask: vi.fn(),
  fetchTaskModeData: vi.fn(),
}));

vi.mock('@/lib/api/server', () => ({
  fetchMarketStats,
  fetchTask,
  fetchTaskModeData,
}));

vi.mock('@/components/market/caller-scoped-task-detail', () => ({
  CallerScopedTaskDetail: ({
    focusIntent,
    task,
  }: {
    focusIntent?: string;
    task: { id: string };
  }) => (
    <div>
      Caller-scoped {task.id} {focusIntent}
    </div>
  ),
}));

vi.mock('@/components/market/private-task-access-gate', () => ({
  PrivateTaskAccessGate: ({ taskId }: { taskId: string }) => <div>Private gate {taskId}</div>,
}));

vi.mock('@/components/market/tasks', () => ({
  TaskDetailPanel: () => <div>Anonymous detail without caller hydration</div>,
}));

import TaskDetailPage from './page';

const task = { id: 'contest/task' } as unknown as TaskDetailResponse;

describe('dashboard task detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTask.mockResolvedValue(task);
    fetchTaskModeData.mockResolvedValue({ submissions: [] });
    fetchMarketStats.mockResolvedValue(null);
  });

  it('keeps the server fetch and delegates caller hydration to the focused client leaf', async () => {
    render(
      await TaskDetailPage({
        params: Promise.resolve({ taskId: 'contest%2Ftask' }),
        searchParams: Promise.resolve({ focus: 'appeal_verdict' }),
      })
    );

    expect(fetchTask).toHaveBeenCalledWith('contest/task');
    expect(screen.getByText('Caller-scoped contest/task appeal_verdict')).toBeInTheDocument();
    expect(screen.queryByText(/without caller hydration/i)).not.toBeInTheDocument();
  });
});
