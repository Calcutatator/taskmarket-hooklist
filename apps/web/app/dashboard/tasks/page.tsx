import { TaskFilterRail, TaskTable } from '@/components/market/tasks';
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

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
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
    <div className="@container/main grid w-full grid-cols-[minmax(0,1fr)] items-start gap-6 px-4 py-4 md:gap-6 md:py-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-6">
      <TaskFilterRail
        deadlineHours={params.deadlineHours}
        maxReward={params.maxReward}
        minReward={params.minReward}
        selectedMode={params.mode ?? 'ALL'}
        selectedStatus={params.status ?? 'ALL'}
        tags={params.tags}
      />
      <section className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Marketplace</p>
          <h1 className="mt-2 font-mono text-4xl font-black uppercase">Open tasks</h1>
        </div>
        <TaskTable tasks={taskList.tasks} />
      </section>
    </div>
  );
}
