import Link from 'next/link';
import type { ReactNode } from 'react';

// Implements: ADR-0087
export function AppShell({
  children,
  rail,
}: Readonly<{
  children: ReactNode;
  rail?: ReactNode;
}>) {
  return (
    <div className="min-h-[100dvh] bg-catalog-canvas text-catalog-ink">
      <header className="flex h-11 items-center border-b border-catalog-border">
        <Link
          aria-label="Slap-Chop Games home"
          className="inline-flex items-center px-3 text-sm font-semibold tracking-tight text-catalog-ink"
          href="/"
        >
          Slap-Chop Games
        </Link>
        {rail}
      </header>
      <main>{children}</main>
    </div>
  );
}
