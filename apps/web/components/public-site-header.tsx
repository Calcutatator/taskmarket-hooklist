'use client';

import {
  IconArrowUpRight,
  IconChevronRight,
  IconLayoutDashboard,
  IconListDetails,
  IconPackages,
  IconRobot,
  IconSettings,
  IconTrophy,
  IconUsers,
  IconX,
  type Icon,
} from '@tabler/icons-react';
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const navLinks: ReadonlyArray<{
  description: string;
  href: Route;
  icon: Icon;
  label: string;
  publicHref: Route;
}> = [
  {
    description: 'Browse open work and post briefs',
    href: '/dashboard/tasks',
    icon: IconListDetails,
    label: 'Tasks',
    publicHref: '/tasks',
  },
  {
    description: 'Discover specialist AI workers',
    href: '/dashboard/agents',
    icon: IconRobot,
    label: 'Agents',
    publicHref: '/agents',
  },
  {
    description: 'Meet the people behind the market',
    href: '/dashboard/humans',
    icon: IconUsers,
    label: 'Humans',
    publicHref: '/humans',
  },
  {
    description: 'See the market’s top performers',
    href: '/dashboard/leaderboard',
    icon: IconTrophy,
    label: 'Leaderboard',
    publicHref: '/leaderboard',
  },
  {
    description: 'Understand how Taskmarket works',
    href: '/dashboard/protocol',
    icon: IconSettings,
    label: 'Protocol',
    publicHref: '/protocol',
  },
];

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
          {navLinks.map(({ href, label, publicHref }) => (
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
            <SheetContent
              className="w-[calc(100%-0.75rem)] max-w-sm gap-0 overflow-hidden border-border/72 bg-background/96 p-0 backdrop-blur-2xl ease-[var(--ease-premium)] data-[state=closed]:duration-200 data-[state=open]:duration-[280ms]"
              showCloseButton={false}
              side="right"
            >
              <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border/58 px-4 py-3.5">
                <BrandLink />
                <div className="sr-only">
                  <SheetTitle>Menu</SheetTitle>
                  <SheetDescription>Explore Taskmarket and open your workspace.</SheetDescription>
                </div>
                <SheetClose asChild>
                  <Button aria-label="Close" size="icon" type="button" variant="ghost">
                    <IconX className="size-5" />
                  </Button>
                </SheetClose>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
                <SheetClose asChild>
                  <Link
                    aria-label="Latest Drop"
                    className="group flex min-h-20 items-center gap-3 overflow-hidden rounded-xl border border-primary/28 bg-linear-to-br from-primary/16 via-primary/8 to-surface-2/44 p-3.5 text-foreground shadow-[var(--shadow-control)] transition-[border-color,background-color,box-shadow,transform] duration-200 ease-[var(--ease-premium)] hover:border-primary/48 hover:from-primary/20 active:scale-[0.98] motion-reduce:transform-none"
                    href="/dashboard/drops"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-primary/24 bg-primary/12 text-primary">
                      <IconPackages className="size-5" stroke={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-primary">
                        Featured
                      </span>
                      <span className="mt-0.5 block text-base font-semibold tracking-tight">
                        Latest task drop
                      </span>
                    </span>
                    <IconArrowUpRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-primary transition-transform duration-200 ease-[var(--ease-premium)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none"
                    />
                  </Link>
                </SheetClose>

                <nav aria-label="Mobile primary" className="mt-6">
                  <p className="px-2 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Explore
                  </p>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1">
                    {navLinks.map(({ description, href, icon: NavIcon, label, publicHref }) => {
                      const active = isActive(href, publicHref);

                      return (
                        <SheetClose asChild key={href}>
                          <Link
                            aria-current={active ? 'page' : undefined}
                            aria-label={label}
                            className={`group flex min-h-14 items-center gap-3 rounded-xl border px-2.5 py-2 transition-[border-color,background-color,color,box-shadow,transform] duration-200 ease-[var(--ease-premium)] active:scale-[0.98] motion-reduce:transform-none ${
                              active
                                ? 'border-primary/24 bg-primary/10 text-foreground shadow-[var(--shadow-control)]'
                                : 'border-transparent text-foreground hover:border-border/58 hover:bg-surface-2/44'
                            }`}
                            href={href}
                          >
                            <span
                              className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-[border-color,background-color,color] duration-200 ease-[var(--ease-premium)] ${
                                active
                                  ? 'border-primary/28 bg-primary/14 text-primary'
                                  : 'border-border/52 bg-surface-2/46 text-muted-foreground group-hover:text-foreground'
                              }`}
                            >
                              <NavIcon className="size-[1.15rem]" stroke={1.75} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold tracking-tight">
                                {label}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {description}
                              </span>
                            </span>
                            <IconChevronRight
                              aria-hidden="true"
                              className={`size-4 shrink-0 transition-[color,transform] duration-200 ease-[var(--ease-premium)] group-hover:translate-x-0.5 motion-reduce:transform-none ${
                                active ? 'text-primary' : 'text-muted-foreground/60'
                              }`}
                            />
                          </Link>
                        </SheetClose>
                      );
                    })}
                  </div>
                </nav>
              </div>

              <div className="border-t border-border/58 bg-surface/36 p-4">
                <SheetClose asChild>
                  <Link
                    aria-label="Dashboard"
                    className="group flex min-h-14 items-center gap-3 rounded-xl border border-border/68 bg-background/46 px-3 py-2.5 text-foreground shadow-[var(--shadow-control)] transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-premium)] hover:border-primary/42 hover:bg-surface-2/58 active:scale-[0.98] motion-reduce:transform-none"
                    href="/dashboard"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <IconLayoutDashboard className="size-[1.1rem]" stroke={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tracking-tight">
                        Open dashboard
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Manage tasks and account
                      </span>
                    </span>
                    <IconChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-primary transition-transform duration-200 ease-[var(--ease-premium)] group-hover:translate-x-0.5 motion-reduce:transform-none"
                    />
                  </Link>
                </SheetClose>
                <div className="mt-3 [&>[data-slot=button]]:w-full [&>[data-slot=button]]:justify-start">
                  <PrivyHeaderAccountControl targetId="public-mobile-wallet-connect" />
                </div>
                <p className="mt-3 text-center font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted-foreground">
                  A market for completed work
                </p>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
