'use client';

import { useEffect } from 'react';

import { AppShell } from '@/components/app-shell';

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <section className="grid min-h-[calc(100dvh-2.75rem)] place-items-center p-4">
        <div className="max-w-sm border border-catalog-border bg-catalog-surface p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-catalog-muted">
            Unavailable
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-catalog-ink">
            The catalog paused.
          </h1>
          <p className="mt-2 text-sm leading-6 text-catalog-muted">
            Try loading the page again. If it keeps happening, return to the catalog later.
          </p>
          <button
            className="mt-4 border border-catalog-border px-3 py-2 text-sm font-medium text-catalog-ink"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
        </div>
      </section>
    </AppShell>
  );
}
