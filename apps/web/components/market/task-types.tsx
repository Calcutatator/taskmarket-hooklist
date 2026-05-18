import { IconArrowRight } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { auctionTypeOptions, taskModeOptions } from '@/lib/market/task-mode-config';

type TaskMode = (typeof taskModeOptions)[number];
type AuctionType = (typeof auctionTypeOptions)[number];

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="grid gap-2">
      <Badge className="w-fit" variant="outline">
        {kicker}
      </Badge>
      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight">{title}</h2>
    </div>
  );
}

function TaskModeCard({ mode }: { mode: TaskMode }) {
  const Icon = mode.icon;
  return (
    <Card className="transition-colors duration-300 ease-[var(--ease-premium)] hover:border-primary/40 hover:bg-card/58">
      <CardHeader>
        <div
          className="relative mb-1 aspect-[5/4] overflow-hidden rounded-md border border-border/58 bg-surface/50"
          data-task-mode-image={mode.value}
        >
          <img
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
            loading="lazy"
            src={mode.imageSrc}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/80 via-card/0 to-transparent"
          />
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-primary/28 bg-primary/12 px-2.5 py-1 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-primary">
            <Icon className="size-3.5" />
            {mode.value}
          </span>
        </div>
        <h3 className="font-display text-lg font-semibold leading-none tracking-tight">
          {mode.label}
        </h3>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm leading-6 text-muted-foreground">
        <p>{mode.body}</p>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-4 gap-y-2 border-t border-border/58 pt-4">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-foreground/70">
            Winner
          </dt>
          <dd className="text-sm leading-snug text-muted-foreground">{mode.winner}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-foreground/70">
            Approval
          </dt>
          <dd className="text-sm leading-snug text-muted-foreground">{mode.accept}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-foreground/70">
            Workers
          </dt>
          <dd className="text-sm leading-snug text-muted-foreground">{mode.concurrency}</dd>
        </dl>
        <a
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          href={`/dashboard/tasks?mode=${mode.value}`}
        >
          View open {mode.label.toLowerCase()} tasks
          <IconArrowRight className="size-3.5" />
        </a>
      </CardContent>
    </Card>
  );
}

function AuctionRuleCard({ auctionType }: { auctionType: AuctionType }) {
  const Icon = auctionType.icon;
  return (
    <Card className="transition-colors duration-300 ease-[var(--ease-premium)] hover:border-primary/40 hover:bg-card/58">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/28 bg-primary/12 text-primary">
            <Icon className="size-4" />
          </span>
          <h3 className="font-display text-base font-semibold leading-none tracking-tight">
            {auctionType.label}
          </h3>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm leading-6 text-muted-foreground">
        <p>{auctionType.mechanism}</p>
        <code className="w-fit rounded-full border border-border/58 bg-surface/52 px-3 py-1 font-mono text-[11px] tracking-tight text-foreground/84">
          {auctionType.action}
        </code>
      </CardContent>
    </Card>
  );
}

export function TaskTypesContent() {
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="grid gap-4">
          <Badge className="w-fit" variant="terminal">
            Market mechanisms
          </Badge>
          <h1 className="font-display text-4xl font-semibold tracking-tight leading-none sm:text-5xl">
            Task modes
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Choose the selection, concurrency, and settlement rules for the work.
          </p>
        </div>
        <Button asChild>
          <a href="/dashboard/tasks/new">Post a task</a>
        </Button>
      </section>

      <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {taskModeOptions.map((mode) => (
          <TaskModeCard key={mode.value} mode={mode} />
        ))}
      </section>

      <section className="grid gap-5">
        <SectionHeading kicker="Auction subtypes" title="Auction price rules" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {auctionTypeOptions.map((auctionType) => (
            <AuctionRuleCard auctionType={auctionType} key={auctionType.value} />
          ))}
        </div>
      </section>
    </div>
  );
}
