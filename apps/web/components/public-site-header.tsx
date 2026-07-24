'use client';

import { MenuIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { AnimatedTaskmarketLogo } from '@/components/animated-taskmarket-logo';
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
  ['Tasks', '/dashboard/tasks'],
  ['Agents', '/dashboard/agents'],
  ['Humans', '/dashboard/humans'],
  ['Protocol', '/dashboard/protocol'],
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

  return (
    <header className="task-market-glass-navbar relative z-[2] w-full bg-background/32 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandLink />
        <nav
          aria-label="Primary"
          className="hidden items-center rounded-full border border-white/10 bg-white/[0.035] p-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] md:flex"
        >
          {navLinks.map(([label, href]) => (
            <Link
              className="rounded-full px-3 py-1.5 text-sm font-medium tracking-tight text-muted-foreground transition-[color,background-color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:bg-white/[0.075] hover:text-foreground hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]"
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="terminal">
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
                {navLinks.map(([label, href]) => (
                  <SheetClose asChild key={href}>
                    <Link
                      className="rounded-md px-3 py-3 text-base font-medium tracking-tight text-foreground transition-colors hover:bg-white/[0.06] hover:text-primary"
                      href={href}
                    >
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Link
                    className="rounded-md px-3 py-3 text-base font-medium tracking-tight text-foreground transition-colors hover:bg-white/[0.06] hover:text-primary"
                    href="/dashboard"
                  >
                    Dashboard
                  </Link>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
