import Link from 'next/link';

import { AppShell } from '@/components/app-shell';

export default function NotFound() {
  return (
    <AppShell>
      <section className="grid min-h-[calc(100dvh-2.75rem)] place-items-center p-4">
        <div className="max-w-sm border border-catalog-border bg-catalog-surface p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-catalog-muted">404</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-catalog-ink">
            Page not found
          </h1>
          <p className="mt-2 text-sm leading-6 text-catalog-muted">
            This catalog address does not exist.
          </p>
          <Link
            className="mt-4 inline-flex text-sm font-medium text-catalog-ink underline underline-offset-4"
            href="/"
          >
            Back to the catalog
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
