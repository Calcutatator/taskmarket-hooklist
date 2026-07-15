import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { TaskDropSubscribeForm } from '@/components/market/task-drop-subscribe-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchTaskDrop } from '@/lib/api/server';
import { compactAddress, formatUsdcUnits } from '@/lib/format';
import { buildPageMetadata, decodeRouteParam } from '@/lib/seo';

type DropPageProps = {
  params: Promise<{
    dropId: string;
  }>;
};

const getDrop = cache(fetchTaskDrop);

function taskTitle(description: string) {
  const firstLine = description.split('\n').find(Boolean)?.trim();
  if (!firstLine) {
    return 'Untitled task';
  }
  return firstLine.length > 90 ? `${firstLine.slice(0, 87).trimEnd()}...` : firstLine;
}

export async function generateMetadata({ params }: DropPageProps): Promise<Metadata> {
  const { dropId } = await params;
  const decodedDropId = decodeRouteParam(dropId);

  try {
    const data = await getDrop(decodedDropId);
    if (data) {
      return buildPageMetadata({
        description:
          data.drop.description ??
          (data.drop.isOfficial
            ? `Explore ${data.drop.name} and subscribe to future official Task Drop launches.`
            : `Follow ${data.drop.name} and get notified when new tasks are published into it.`),
        path: `/drops/${encodeURIComponent(decodedDropId)}`,
        title: data.drop.name,
      });
    }
  } catch {
    return buildPageMetadata({
      description: 'Follow this Taskmarket drop and inspect its tasks.',
      path: `/drops/${encodeURIComponent(decodedDropId)}`,
      title: 'Task Drop',
    });
  }

  return buildPageMetadata({
    description: 'Follow this Taskmarket drop and inspect its tasks.',
    path: `/drops/${encodeURIComponent(decodedDropId)}`,
    title: 'Task Drop not found',
  });
}

export default async function DropPage({ params }: DropPageProps) {
  const { dropId } = await params;
  const data = await getDrop(decodeRouteParam(dropId));

  if (!data) {
    notFound();
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
      <main className="grid min-w-0 gap-6">
        <section className="grid gap-4 border-b border-border/58 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="terminal">Task Drop</Badge>
            {data.drop.isOfficial ? <Badge variant="secondary">Official</Badge> : null}
            <span
              className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground"
              title={data.drop.officialWalletAddress}
            >
              <span className="uppercase">Publisher wallet</span>
              <span>{compactAddress(data.drop.officialWalletAddress)}</span>
            </span>
          </div>
          <div className="grid gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              {data.drop.name}
            </h1>
            {data.drop.description ? (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {data.drop.description}
              </p>
            ) : null}
            <dl className="grid max-w-3xl gap-1 rounded-lg border border-border/58 bg-surface/42 p-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <dt className="font-mono text-xs uppercase text-muted-foreground">
                Publisher wallet
              </dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {data.drop.officialWalletAddress}
              </dd>
            </dl>
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">Tasks</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.tasks.length} {data.tasks.length === 1 ? 'task' : 'tasks'} in this drop.
              </p>
            </div>
            <Link className="text-sm font-semibold text-primary hover:underline" href="/tasks">
              Browse all tasks
            </Link>
          </div>

          {data.tasks.length > 0 ? (
            <div className="grid gap-3">
              {data.tasks.map((task) => (
                <Link
                  className="grid gap-3 rounded-lg border border-border/68 bg-card/42 p-4 transition-colors hover:border-primary/45"
                  href={`/tasks/${task.id}` as Route}
                  key={task.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{task.mode}</Badge>
                    <Badge variant="outline">{task.status}</Badge>
                    <span className="font-mono text-xs text-primary">
                      {formatUsdcUnits(task.reward)}
                    </span>
                  </div>
                  <h3 className="font-sans text-base font-semibold text-foreground">
                    {taskTitle(task.description)}
                  </h3>
                  {task.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {task.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-border/68 bg-card/42 p-4 text-sm text-muted-foreground">
              No tasks have been published into this drop yet.
            </p>
          )}
        </section>
      </main>

      <aside className="h-fit lg:sticky lg:top-20">
        <Card>
          <CardHeader>
            <CardTitle>
              {data.drop.isOfficial ? 'Get official drops' : 'Follow this drop'}
            </CardTitle>
            <CardDescription>
              {data.drop.isOfficial
                ? 'Get one launch announcement for each future official Task Drop.'
                : `Get email when new tasks are published into ${data.drop.name}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TaskDropSubscribeForm isOfficial={data.drop.isOfficial} taskDropId={data.drop.id} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
