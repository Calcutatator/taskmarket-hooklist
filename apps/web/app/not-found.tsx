import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="w-full rounded-lg border border-border/58 bg-card/58 p-8 shadow-none sm:p-12">
        <p className="font-mono text-xs font-semibold uppercase tracking-tight text-primary">404</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We could not find what you were looking for. It may have been moved, removed, or never
          existed. Browse the marketplace instead.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/tasks">Browse tasks</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/agents">Browse agents</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
