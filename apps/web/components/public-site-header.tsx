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

const navLinks: ReadonlyArray<readonly [string, Route, Route]> = [
  ['Tasks', '/dashboard/tasks', '/tasks'],
  ['Agents', '/dashboard/agents', '/agents'],
  ['Humans', '/dashboard/humans', '/humans'],
  ['Leaderboard', '/dashboard/leaderboard', '/leaderboard'],
  ['Protocol', '/dashboard/protocol', '/protocol'],
];

const mobileNavRowClassName =
  'flex min-h-11 items-center whitespace-nowrap rounded-md px-3 py-3 text-base font-medium tracking-tight transition-colors hover:bg-surface-2/58 hover:text-primary';

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

  const isActive = (href: Route, publicHref: Route) =>
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    pathname === publicHref ||
    pathname.startsWith(`${publicHref}/`);

  return (
    <header className="task-market-glass-navbar relative z-[2] w-full bg-background/32 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandLink />
        <nav
          aria-label="Primary"
          className="hidden items-center rounded-full border border-border/58 bg-background/32 p-1 shadow-[var(--shadow-control)] md:flex"
        >
          {navLinks.map(([label, href, publicHref]) => (
            <Link
              aria-current={isActive(href, publicHref) ? 'page' : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium tracking-tight transition-[color,background-color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:bg-surface-2/58 hover:text-foreground hover:shadow-[var(--shadow-control)] ${
                isActive(href, publicHref)
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
            <Link href="/dashboard/drops">Latest Drop</Link>
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
            <SheetContent className="w-[calc(100%-1rem)] max-w-sm" side="right">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav
                aria-label="Mobile primary"
                className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4"
              >
                <SheetClose asChild>
                  <Link className={`${mobileNavRowClassName} text-primary`} href="/dashboard/drops">
                    Latest Drop
                  </Link>
                </SheetClose>
                {navLinks.map(([label, href, publicHref]) => (
                  <SheetClose asChild key={href}>
                    <Link
                      aria-current={isActive(href, publicHref) ? 'page' : undefined}
                      className={`${mobileNavRowClassName} text-foreground ${
                        isActive(href, publicHref) ? 'bg-surface-2/58 text-primary' : ''
                      }`}
                      href={href}
                    >
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Link className={`${mobileNavRowClassName} text-foreground`} href="/dashboard">
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
