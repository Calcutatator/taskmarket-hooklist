import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PublicHook } from '@/lib/hooklist';

export function HookInspection({
  errorMessage,
  hook,
}: {
  errorMessage?: string;
  hook: PublicHook | null;
}) {
  if (errorMessage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load this hook</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/hooks">Return to Hooklist</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!hook)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hook not found in the public feed</CardTitle>
          <CardDescription>
            This address was not returned by the current public task projection. It may be private
            or not currently referenced by a public task.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/hooks">Return to Hooklist</Link>
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <section aria-labelledby="hook-inspection-heading" className="grid gap-5">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Observed hook
        </p>
        <h1
          id="hook-inspection-heading"
          className="mt-2 break-all font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
        >
          {hook.address}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          This record is derived from public task references. It does not make claims about the
          hook’s source, proxy, privileged roles, security posture, liveness, conformance, listing,
          or protocol-default status.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Usage on Taskmarket</CardTitle>
          <CardDescription>
            {hook.taskCount} observed tasks, including {hook.activePhaseTaskCount} in the active
            lifecycle phase. Review, appeal, dispute, and expired-awaiting-settlement tasks are
            excluded from this count.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {hook.modes.map((mode) => (
              <Badge key={mode} variant="terminal">
                {mode}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {hook.taskIds.slice(0, 8).map((taskId) => (
              <Button asChild key={taskId} size="sm" variant="outline">
                <Link href={`/tasks/${taskId}`}>View task {taskId.slice(2, 8)}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Button asChild className="w-fit" variant="terminal">
        <Link href={`/hooks/build?address=${encodeURIComponent(hook.address)}`}>
          Configure a manifest from this address
        </Link>
      </Button>
    </section>
  );
}
