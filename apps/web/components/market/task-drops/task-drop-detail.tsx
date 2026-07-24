import type { TaskDropPageData, TaskDropTask } from '@taskmarket/shared';
import type { Route } from 'next';

import {
  IconCalendarDue,
  IconCoin,
  IconExternalLink,
  IconLayoutGrid,
  IconRosetteDiscountCheck,
} from '@tabler/icons-react';
import Link from 'next/link';

import { TaskDropSubscribeForm } from '@/components/market/task-drop-subscribe-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { taskStatusLabel, type BadgeVariant } from '@/lib/market/task-badges';
import { formatTimeLeft, formatUsdcUnits } from '@/lib/format';

const DELIVERY_WINDOW_STATUSES = new Set(['open', 'claimed', 'worker_selected']);
const CLOSED_TASK_STATUSES = new Set(['completed', 'expired', 'cancelled']);

function taskTitle(description: string) {
  const firstLine = description.split('\n').find(Boolean)?.trim();
  if (!firstLine) {
    return 'Untitled task';
  }
  return firstLine.length > 90 ? `${firstLine.slice(0, 87).trimEnd()}...` : firstLine;
}

function isBeforeDeadline(task: TaskDropTask, now: Date) {
  const expiry = new Date(task.expiryTime).getTime();
  return Number.isFinite(expiry) && expiry > now.getTime();
}

function isAvailableTask(task: TaskDropTask, now: Date) {
  return DELIVERY_WINDOW_STATUSES.has(task.status) && isBeforeDeadline(task, now);
}

function sumRewards(tasks: TaskDropTask[]) {
  return tasks.reduce((total, task) => {
    try {
      return total + BigInt(task.reward);
    } catch {
      return total;
    }
  }, 0n);
}

function formatDeadline(value: string | null) {
  if (!value) return 'No open deadline';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No open deadline';

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function taskBadgeVariant(task: TaskDropTask, available: boolean): BadgeVariant {
  if (available) return 'success';
  if (task.status === 'completed') return 'secondary';
  if (task.status === 'disputed') return 'destructive';
  if (task.status === 'review' || task.status === 'pending_approval') return 'warning';
  return 'outline';
}

function TaskCard({
  now,
  task,
  taskHrefBase,
}: {
  now: Date;
  task: TaskDropTask;
  taskHrefBase: '/tasks' | '/dashboard/tasks';
}) {
  const available = isAvailableTask(task, now);
  const title = taskTitle(task.description);
  const deadline = formatTimeLeft(task.expiryTime, now.getTime());

  return (
    <Link
      className="group grid min-h-44 gap-4 rounded-xl border border-border/68 bg-card/48 p-5 shadow-[var(--shadow-card)] transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/42 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
      href={`${taskHrefBase}/${encodeURIComponent(task.id)}` as Route}
      title={title}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={taskBadgeVariant(task, available)}>
          {available ? 'Available' : taskStatusLabel(task.status)}
        </Badge>
        <Badge className="capitalize" variant="outline">
          {task.mode.replaceAll('_', ' ')}
        </Badge>
      </div>

      <h3 className="font-display text-lg leading-snug font-semibold tracking-tight text-foreground">
        {title}
      </h3>

      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border/54 pt-3 font-mono text-xs">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-primary">
          <IconCoin aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
          {formatUsdcUnits(task.reward)}
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1.5 text-muted-foreground">
          <IconCalendarDue aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
          {deadline.label}
        </span>
      </div>

      {task.tags.length > 0 ? (
        <div aria-label="Task tags" className="flex flex-wrap gap-1.5">
          {task.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="terminal">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground group-hover:text-primary">
        View task
        <IconExternalLink aria-hidden="true" className="size-4" stroke={1.75} />
      </span>
    </Link>
  );
}

function TaskSection({
  description,
  emptyMessage,
  id,
  now,
  taskHrefBase,
  tasks,
  title,
}: {
  description: string;
  emptyMessage: string;
  id: string;
  now: Date;
  taskHrefBase: '/tasks' | '/dashboard/tasks';
  tasks: TaskDropTask[];
  title: string;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground" id={id}>
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      {tasks.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} now={now} task={task} taskHrefBase={taskHrefBase} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/76 bg-surface/34 p-5 text-sm leading-6 text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

export function TaskDropDetail({
  data,
  now = new Date(),
  taskHrefBase,
}: {
  data: TaskDropPageData;
  now?: Date;
  taskHrefBase: '/tasks' | '/dashboard/tasks';
}) {
  const availableTasks = data.tasks.filter((task) => isAvailableTask(task, now));
  const completedTasks = data.tasks.filter((task) => CLOSED_TASK_STATUSES.has(task.status));
  const activeIds = new Set(availableTasks.map((task) => task.id));
  const completedIds = new Set(completedTasks.map((task) => task.id));
  const inProgressTasks = data.tasks.filter(
    (task) => !activeIds.has(task.id) && !completedIds.has(task.id)
  );
  const nearestDeadline =
    availableTasks
      .map((task) => task.expiryTime)
      .filter((value) => Number.isFinite(new Date(value).getTime()))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;
  const browseTasksHref = taskHrefBase;

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="relative isolate overflow-hidden rounded-xl border border-border/64 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 -z-10 hidden w-2/5 bg-[linear-gradient(135deg,transparent_10%,color-mix(in_oklab,var(--primary)_8%,transparent)_10%,color-mix(in_oklab,var(--primary)_8%,transparent)_18%,transparent_18%,transparent_32%,color-mix(in_oklab,var(--primary)_5%,transparent)_32%,color-mix(in_oklab,var(--primary)_5%,transparent)_40%,transparent_40%)] sm:block"
        />
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="terminal">Task Drop</Badge>
            {data.drop.isOfficial ? (
              <Badge variant="secondary">
                <IconRosetteDiscountCheck aria-hidden="true" stroke={1.75} />
                Official
              </Badge>
            ) : null}
          </div>
          <h1 className="mt-5 font-display text-4xl leading-tight font-semibold tracking-tight text-foreground sm:text-5xl">
            {data.drop.name}
          </h1>
          {data.drop.description ? (
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              {data.drop.description}
            </p>
          ) : null}
          <p className="mt-5 max-w-full font-mono text-xs text-muted-foreground">
            Published by{' '}
            <span className="select-all break-all font-semibold text-foreground">
              {data.drop.officialWalletAddress}
            </span>
          </p>
        </div>
      </header>

      <dl
        aria-label="Task Drop summary"
        className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/64 bg-surface/44 sm:grid-cols-4"
      >
        <div className="grid gap-1 border-b border-border/58 p-4 sm:border-r sm:border-b-0">
          <dt className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <IconRosetteDiscountCheck aria-hidden="true" className="size-4" stroke={1.75} />
            Work
          </dt>
          <dd className="font-display text-xl font-semibold text-foreground">
            {availableTasks.length} available
          </dd>
        </div>
        <div className="grid gap-1 border-b border-l border-border/58 p-4 sm:border-r sm:border-b-0 sm:border-l-0">
          <dt className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <IconLayoutGrid aria-hidden="true" className="size-4" stroke={1.75} />
            Tasks
          </dt>
          <dd className="font-display text-xl font-semibold text-foreground">
            {data.tasks.length} total
          </dd>
        </div>
        <div className="grid gap-1 p-4 sm:border-r sm:border-border/58">
          <dt className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <IconCoin aria-hidden="true" className="size-4" stroke={1.75} />
            Reward pool
          </dt>
          <dd className="font-display text-xl font-semibold text-foreground">
            {formatUsdcUnits(sumRewards(data.tasks).toString())}
          </dd>
        </div>
        <div className="grid gap-1 border-l border-border/58 p-4 sm:border-l-0">
          <dt className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <IconCalendarDue aria-hidden="true" className="size-4" stroke={1.75} />
            Nearest deadline
          </dt>
          <dd className="font-display text-xl font-semibold text-foreground">
            {formatDeadline(nearestDeadline)}
          </dd>
        </div>
      </dl>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <aside
          aria-label="Drop alerts"
          className="h-fit lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1"
        >
          <Card className="border-primary/24 bg-card">
            <CardHeader>
              <CardTitle>
                {data.drop.isOfficial ? 'Get official drops' : 'Follow this drop'}
              </CardTitle>
              <CardDescription>
                {data.drop.isOfficial
                  ? 'Get one email when each future official Task Drop launches.'
                  : `Get email when new tasks are published into ${data.drop.name}.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TaskDropSubscribeForm isOfficial={data.drop.isOfficial} taskDropId={data.drop.id} />
            </CardContent>
          </Card>
        </aside>

        <section
          aria-label="Task catalogue"
          className="grid min-w-0 gap-10 lg:col-start-1 lg:row-start-1"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                Explore the drop
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a task to review its full brief, rules, and submission window.
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={browseTasksHref}
            >
              Browse all tasks
              <IconExternalLink aria-hidden="true" className="size-4" stroke={1.75} />
            </Link>
          </div>

          <TaskSection
            description="Tasks with an active delivery window."
            emptyMessage="New tasks will appear here when they are published into this drop."
            id="available-tasks-heading"
            now={now}
            taskHrefBase={taskHrefBase}
            tasks={availableTasks}
            title="Available tasks"
          />

          {inProgressTasks.length > 0 ? (
            <TaskSection
              description="Tasks that are being delivered, judged, or settled."
              emptyMessage=""
              id="work-in-progress-heading"
              now={now}
              taskHrefBase={taskHrefBase}
              tasks={inProgressTasks}
              title="Work in progress"
            />
          ) : null}

          <TaskSection
            description="Accepted work and tasks that have reached a closed outcome."
            emptyMessage="Accepted work will appear here after judging is complete."
            id="completed-work-heading"
            now={now}
            taskHrefBase={taskHrefBase}
            tasks={completedTasks}
            title="Completed work"
          />
        </section>
      </div>
    </div>
  );
}
