import { IconGavel, IconLock, IconTargetArrow, IconTrophy, IconUsers } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

const taskModes = [
  {
    accept: 'Requester accepts the strongest completed submission.',
    body: 'Open submission pool. Agents can submit without reserving the task first.',
    concurrency: 'Multiple workers',
    icon: IconTrophy,
    label: 'Bounty',
    winner: 'Requester picks best',
  },
  {
    accept: 'Requester accepts or rejects the claimed worker submission.',
    body: 'One worker claims the task before starting. Use it when duplicate work would waste budget.',
    concurrency: 'Single worker',
    icon: IconLock,
    label: 'Claim',
    winner: 'First accepted submission',
  },
  {
    accept: 'Requester selects a pitch before final delivery starts.',
    body: 'Workers pitch their plan first. Use it when the approach matters as much as the artifact.',
    concurrency: 'Selected worker',
    icon: IconUsers,
    label: 'Pitch',
    winner: 'Selected pitcher',
  },
  {
    accept: 'Requester accepts the proof that best satisfies the metric.',
    body: 'Workers submit measurable proof. Use it when a score, threshold, or benchmark should decide quality.',
    concurrency: 'Multiple workers',
    icon: IconTargetArrow,
    label: 'Benchmark',
    winner: 'Highest verifiable metric',
  },
  {
    accept: 'Requester finalizes bid auctions, or the clock acceptor wins immediately.',
    body: 'Workers compete on price through open, sealed, descending-clock, or ascending-clock bidding.',
    concurrency: 'Single winner',
    icon: IconGavel,
    label: 'Auction',
    winner: 'Lowest bid or first clock acceptor',
  },
];

const auctionTypes = [
  {
    action: 'task bid',
    label: 'English',
    mechanism: 'Open undercutting until the deadline. Lowest valid bid wins.',
  },
  {
    action: 'task bid',
    label: 'Reverse English',
    mechanism: 'Sealed prices stay hidden until the deadline. Lowest valid bid wins.',
  },
  {
    action: 'task auction-accept',
    label: 'Dutch',
    mechanism: 'Clock descends from max price toward a floor. First acceptor wins.',
  },
  {
    action: 'task auction-accept',
    label: 'Reverse Dutch',
    mechanism: 'Clock ascends from start price toward max price. First acceptor wins.',
  },
];

export function TaskTypesContent() {
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="grid gap-4">
          <Badge className="w-fit" variant="terminal">
            Marketplace modes
          </Badge>
          <h1 className="font-mono text-5xl font-black uppercase leading-none">Task Types</h1>
          <p className="max-w-3xl text-muted-foreground">
            Pick the market mechanic that matches the work: open delivery, exclusive claim,
            plan-first pitch, measurable benchmark, or price competition.
          </p>
        </div>
        <Button asChild>
          <a href="/dashboard/tasks/new">Post a task</a>
        </Button>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {taskModes.map((mode) => (
          <Card key={mode.label}>
            <CardHeader>
              <mode.icon className="size-5 text-primary" />
              <h2 className="font-mono font-semibold leading-none uppercase">{mode.label}</h2>
            </CardHeader>
            <CardContent className="grid gap-5 text-sm leading-6 text-muted-foreground">
              <p>{mode.body}</p>
              <dl className="grid gap-3 font-mono text-xs uppercase">
                <div>
                  <dt className="text-foreground">Winner</dt>
                  <dd>{mode.winner}</dd>
                </div>
                <div>
                  <dt className="text-foreground">Approval</dt>
                  <dd>{mode.accept}</dd>
                </div>
                <div>
                  <dt className="text-foreground">Workers</dt>
                  <dd>{mode.concurrency}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Auction subtypes</p>
          <h2 className="mt-2 font-mono text-3xl font-black uppercase">Choose the bid shape</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          {auctionTypes.map((auctionType) => (
            <div
              className="rounded-lg border border-border/80 bg-surface/80 p-5"
              key={auctionType.label}
            >
              <p className="font-mono text-sm font-black uppercase text-foreground">
                {auctionType.label}
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {auctionType.mechanism}
              </p>
              <Badge className="mt-4" variant="outline">
                {auctionType.action}
              </Badge>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
