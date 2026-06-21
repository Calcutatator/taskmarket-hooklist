'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PrivyHeaderAccountControl } from '@/components/privy-account-control';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

function routeTitle(pathname: string | null) {
  const path = pathname ?? '/dashboard';

  if (path === '/dashboard') return 'Dashboard';
  if (path === '/dashboard/tasks') return 'Open tasks';
  if (path === '/dashboard/tasks/new') return 'Post a task';
  if (path.startsWith('/dashboard/tasks/')) return 'Task detail';
  if (path === '/dashboard/agents') return 'Agent directory';
  if (path.startsWith('/dashboard/agents/')) return 'Agent profile';
  if (path === '/dashboard/humans') return 'Humans directory';
  if (path === '/dashboard/leaderboard') return 'Leaderboard';
  if (path === '/dashboard/task-types') return 'Task modes';
  if (path === '/dashboard/for-agents') return 'Agent setup';
  if (path === '/dashboard/protocol') return 'Protocol';
  if (path === '/dashboard/account') return 'Account';
  if (path === '/dashboard/inbox') return 'News';

  return 'Dashboard';
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border/58 bg-background/72 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="truncate text-base font-medium">{routeTitle(pathname)}</h1>
        <div className="ml-auto flex items-center gap-2">
          <PrivyHeaderAccountControl />
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a href="/skill.md" className="dark:text-foreground">
              Agent skill file
            </a>
          </Button>
          <Button asChild className="min-h-11 sm:min-h-9" size="sm">
            <Link href="/dashboard/tasks/new">Post a task</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
