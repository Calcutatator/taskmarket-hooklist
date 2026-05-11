import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { auctionTypeOptions, taskModeOptions } from '@/lib/market/task-mode-config';

export function TaskTypesContent() {
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="grid gap-4">
          <Badge className="w-fit" variant="terminal">
            Market mechanisms
          </Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight leading-none">
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

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {taskModeOptions.map((mode) => (
          <Card key={mode.label}>
            <CardHeader>
              <mode.icon className="size-5 text-primary" />
              <h2 className="font-display font-semibold leading-none tracking-tight">
                {mode.label}
              </h2>
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
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Auction price rules
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          {auctionTypeOptions.map((auctionType) => (
            <div
              className="rounded-xl border border-border/68 bg-card/74 p-5 shadow-[var(--shadow-soft)]"
              key={auctionType.label}
            >
              <p className="font-sans text-sm font-semibold tracking-tight text-foreground">
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
