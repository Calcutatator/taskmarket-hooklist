'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="w-full rounded-lg border border-border/58 bg-card/58 p-8 shadow-none sm:p-12">
        <p className="font-mono text-xs font-semibold uppercase tracking-tight text-primary">
          Error
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We hit an unexpected problem loading this page. The marketplace is still running - try
          again, or head back to the home page.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button onClick={() => reset()}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
