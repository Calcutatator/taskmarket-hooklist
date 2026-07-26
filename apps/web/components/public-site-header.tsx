'use client';

import { MenuIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { AnimatedTaskmarketLogo } from '@/components/animated-taskmarket-logo';
import { PrivyHeaderAccountControl } from '@/components/privy-account-control';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const navLinks: ReadonlyArray<readonly [string, Route]> = [
  ['Tasks', '/tasks'],
  ['Agents', '/agents'],
  ['Humans', '/humans'],
  ['Leaderboard', '/leaderboard'],
  ['Protocol', '/protocol'],
];

// The evergreen Task Drop link is /live, added in the same PR as this button. Same destination
// as the URL we paste on X and in Discord, so the button and the shared link cannot drift.
// /live resolves the current drop server-side; nobody updates this href when a new drop opens.
// Deliberately not cast to Route: typed routes should be free to catch it if /live ever goes.

function BrandLink() {
  return (
    <Link aria-label="Taskmarket home" className="block px-1.5 py-1" href="/">
      <AnimatedTaskmarketLogo />
    </Link>
  );
}

export function PublicSiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: Route) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="task-market-glass-navbar relative z-[2] w-full bg-background/32 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandLink />
        <nav
          aria-label="Primary"
          className="hidden items-center rounded-full border border-border/58 bg-background/32 p-1 shadow-[var(--shadow-control)] md:flex"
        >
          {navLinks.map(([label, href]) => (
            <Link
              aria-current={isActive(href) ? 'page' : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium tracking-tight transition-[color,background-color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:bg-surface-2/58 hover:text-foreground hover:shadow-[var(--shadow-control)] ${
                isActive(href)
                  ? 'bg-surface-2/58 text-foreground shadow-[var(--shadow-control)]'
                  : 'text-muted-foreground'
              }`}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <PrivyHeaderAccountControl targetId="public-wallet-connect" />
          <Button asChild className="hidden sm:inline-flex" size="sm" variant="default">
            <Link href="/live">Latest Drop</Link>
          </Button>
          <Button asChild className="hidden sm:inline-flex" size="sm" variant="terminal">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Sheet onOpenChange={setOpen} open={open}>
            <SheetTrigger asChild>
              <Button aria-label="Open menu" className="md:hidden" size="icon" variant="terminal">
                <MenuIcon className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav
                aria-label="Mobile primary"
                className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4"
              >
                <SheetClose asChild>
                  <Link
                    className="flex min-h-11 items-center rounded-md px-3 py-3 text-base font-medium tracking-tight text-primary transition-colors hover:bg-surface-2/58 hover:text-primary"
                    href="/live"
                  >
                    Latest Drop
                  </Link>
                </SheetClose>
                {navLinks.map(([label, href]) => (
                  <SheetClose asChild key={href}>
                    <Link
                      aria-current={isActive(href) ? 'page' : undefined}
                      className={`flex min-h-11 items-center rounded-md px-3 py-3 text-base font-medium tracking-tight text-foreground transition-colors hover:bg-surface-2/58 hover:text-primary ${
                        isActive(href) ? 'bg-surface-2/58 text-primary' : ''
                      }`}
                      href={href}
                    >
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Link
                    className="rounded-md px-3 py-3 text-base font-medium tracking-tight text-foreground transition-colors hover:bg-surface-2/58 hover:text-primary"
                    href="/dashboard"
                  >
                    Dashboard
                  </Link>
                </SheetClose>
                <div className="mt-3 border-t border-border/58 pt-4">
                  <PrivyHeaderAccountControl targetId="public-mobile-wallet-connect" />
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
