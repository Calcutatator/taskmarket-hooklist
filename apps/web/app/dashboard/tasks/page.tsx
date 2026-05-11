import { TaskFilterRail, TaskTable } from '@/components/market/tasks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchTasks } from '@/lib/api/server';

type TasksPageProps = {
  searchParams: Promise<{
    deadlineHours?: string;
    maxReward?: string;
    minReward?: string;
    mode?: string;
    status?: string;
    tags?: string;
  }>;
};

function toBaseUnits(value?: string) {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed)) {
    return undefined;
  }

  return String(Math.round(parsed * 1_000_000));
}

function parseTags(value?: string) {
  return value
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function labelize(value: string) {
  return value.replaceAll('_', ' ');
}

function activeFilters(params: Awaited<TasksPageProps['searchParams']>) {
  const filters: Array<{ label: string; value: string }> = [];

  if (params.mode && params.mode !== 'ALL') {
    filters.push({ label: 'Mode', value: labelize(params.mode) });
  }
  if (params.status && params.status !== 'ALL') {
    filters.push({ label: 'Status', value: labelize(params.status) });
  }
  if (params.tags) {
    filters.push({ label: 'Tags', value: params.tags });
  }
  if (params.minReward) {
    filters.push({ label: 'Min', value: `${params.minReward} USDC` });
  }
  if (params.maxReward) {
    filters.push({ label: 'Max', value: `${params.maxReward} USDC` });
  }
  if (params.deadlineHours) {
    filters.push({ label: 'Deadline', value: `${params.deadlineHours}h` });
  }

  return filters;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const filters = activeFilters(params);
  const taskList = await fetchTasks({
    deadlineHours: params.deadlineHours ? Number(params.deadlineHours) : undefined,
    limit: 40,
    maxReward: toBaseUnits(params.maxReward),
    minReward: toBaseUnits(params.minReward),
    mode: params.mode,
    status: params.status,
    tags: parseTags(params.tags),
  });

  return (
    <div className="@container/main grid w-full grid-cols-[minmax(0,1fr)] items-start gap-6 px-4 py-4 md:gap-6 md:py-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
      <TaskFilterRail
        deadlineHours={params.deadlineHours}
        maxReward={params.maxReward}
        minReward={params.minReward}
        selectedMode={params.mode ?? 'ALL'}
        selectedStatus={params.status ?? 'ALL'}
        tags={params.tags}
      />
      <section className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase text-primary">Marketplace</p>
            <h1 className="mt-2 font-mono text-4xl font-black uppercase">Open tasks</h1>
          </div>
          <Button asChild>
            <a href="/dashboard/tasks/new">Post task</a>
          </Button>
        </div>
        {filters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs uppercase text-muted-foreground">
              Active filters
            </span>
            {filters.map((filter) => (
              <Badge key={`${filter.label}:${filter.value}`} variant="outline">
                {filter.label}: {filter.value}
              </Badge>
            ))}
            <Button asChild size="xs" variant="link">
              <a href="/dashboard/tasks">Clear filters</a>
            </Button>
          </div>
        ) : null}
        <TaskTable hasActiveFilters={filters.length > 0} tasks={taskList.tasks} />
      </section>
    </div>
  );
}
