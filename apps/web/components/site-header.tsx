'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SkillInstallSnippet } from '@/components/market/skill-install-snippet';
import { PrivyHeaderAccountControl } from '@/components/privy-account-control';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { skillInstallCommand } from '@/lib/skill';

function routeTitle(pathname: string | null) {
  const path = pathname ?? '/dashboard';

  if (path === '/dashboard') return 'Dashboard';
  if (path === '/dashboard/tasks') return 'Open tasks';
  if (path === '/dashboard/tasks/new') return 'Post a task';
  if (path.startsWith('/dashboard/tasks/')) return 'Task detail';
  if (path === '/dashboard/drops') return 'Task Drops';
  if (path.startsWith('/dashboard/drops/')) return 'Task Drop detail';
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

  // The tasks list renders its own primary "Post task" CTA in the page header, and the
  // create form IS the post flow -- a second identical primary button in the top bar on
  // those routes is duplicate noise. Keep it everywhere else.
  const showPostTaskCta = pathname !== '/dashboard/tasks' && pathname !== '/dashboard/tasks/new';

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border/58 bg-background/72 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex min-w-0 w-full items-center gap-1 px-2 min-[361px]:px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 max-[360px]:hidden data-[orientation=vertical]:h-4"
        />
        <h1 className="min-w-0 flex-1 truncate text-base font-medium">{routeTitle(pathname)}</h1>
        <ButtonGroup
          aria-label="Dashboard actions"
          className="shrink-0 gap-2 [&>*]:rounded-full! [&>*]:border-l! [&>[data-slot=button]]:px-3.5 [&>[data-slot=button]]:py-0 sm:[&>[data-slot=button]]:h-9 sm:[&>[data-slot=button]]:min-h-9"
        >
          <Button asChild className="hidden sm:inline-flex" size="sm" variant="default">
            <Link href="/dashboard/drops">Latest Drop</Link>
          </Button>
          <PrivyHeaderAccountControl />
          <SkillInstallSnippet
            className="hidden h-9 w-44 max-w-none px-3.5 py-0 sm:flex xl:w-72"
            command={skillInstallCommand()}
          />
          {showPostTaskCta ? (
            <Button asChild className="min-h-11 max-[360px]:hidden sm:min-h-9" size="sm">
              <Link href="/dashboard/tasks/new">Post a task</Link>
            </Button>
          ) : null}
        </ButtonGroup>
      </div>
    </header>
  );
}
