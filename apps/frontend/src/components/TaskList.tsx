import { trpc } from '@/contexts/TRPCProvider';
import { TaskCard } from './TaskCard';
import { Button } from './ui/button';

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
            | 'accepted'
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-48 bg-background-secondary rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary text-lg">Failed to load tasks</p>
        <p className="text-text-tertiary text-sm mt-2">{error.message}</p>
      </div>
    );
  }

  const allTasks = data?.pages.flatMap((p) => p.tasks) ?? [];
  const searchLower = search?.toLowerCase() ?? '';
  const tasks = searchLower
    ? allTasks.filter((task) => task.description.toLowerCase().includes(searchLower))
    : allTasks;

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary text-lg">No tasks found</p>
        <p className="text-text-tertiary text-sm mt-2">
          Try adjusting your filters or create a new task
        </p>
      </div>
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
