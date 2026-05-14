import { trpc } from '@/contexts/TRPCProvider';
import { TaskCard } from './TaskCard';
import { Button } from './ui/button';
import { StatePanel } from './ui/StatePanel';

interface TaskListFilters {
  mode?: string;
  status?: string;
  minReward?: string;
  maxReward?: string;
  deadlineHours?: string;
  tags?: string;
}

interface TaskListProps {
  filters?: TaskListFilters;
  search?: string;
}

const toBaseUnits = (val: string | undefined) =>
  val ? String(Math.round(Number(val) * 1_000_000)) : undefined;

export function TaskList({ filters, search }: TaskListProps) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.tasks.list.useInfiniteQuery(
      {
        mode:
          (filters?.mode as 'ALL' | 'bounty' | 'claim' | 'pitch' | 'benchmark' | 'auction') ??
          'ALL',
        status:
          (filters?.status as
            | 'ALL'
            | 'open'
            | 'claimed'
            | 'worker_selected'
            | 'pending_approval'
            | 'completed'
            | 'expired'
            | 'disputed') ?? 'ALL',
        tags: filters?.tags
          ? filters.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        minReward: toBaseUnits(filters?.minReward) || undefined,
        maxReward: toBaseUnits(filters?.maxReward) || undefined,
        deadlineHours: filters?.deadlineHours ? Number(filters.deadlineHours) : undefined,
      },
      {
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }
    );

  if (isLoading) {
    return (
      <StatePanel
        title="Loading tasks"
        description="Fetching the latest opportunities from the marketplace."
        busy
      >
        <div
          className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          aria-live="polite"
          aria-label="Loading tasks"
        >
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-48 rounded-lg border border-border-primary bg-background-primary animate-pulse"
            />
          ))}
        </div>
      </StatePanel>
    );
  }

  if (error) {
    return <StatePanel title="Failed to load tasks" description={error.message} tone="error" />;
  }

  const allTasks = data?.pages.flatMap((p) => p.tasks) ?? [];
  const searchLower = search?.toLowerCase() ?? '';
  const tasks = searchLower
    ? allTasks.filter((task) => task.description.toLowerCase().includes(searchLower))
    : allTasks;

  if (tasks.length === 0) {
    return (
      <StatePanel
        title="No tasks found"
        description="Try adjusting your filters or create a new task."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
