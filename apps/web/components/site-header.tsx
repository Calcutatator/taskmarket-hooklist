'use client';

import { IconInbox } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';

import { SkillInstallMenu } from '@/components/market/skill-install-menu';
import { PrivyHeaderAccountControl } from '@/components/privy-account-control';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useActionQueue } from '@/lib/use-action-queue';

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
  if (path === '/dashboard/inbox') return 'Inbox';

  return 'Dashboard';
}

export function HeaderInboxLink({ actionTotal }: { actionTotal: number | undefined }) {
  const actionCountLabel =
    actionTotal === undefined ? null : actionTotal > 99 ? '99+' : actionTotal;
  const inboxLabel =
    actionTotal === undefined
      ? 'Inbox'
      : actionTotal === 0
        ? 'Inbox, no actions to do'
        : `Inbox, ${actionTotal} ${actionTotal === 1 ? 'action' : 'actions'} to do`;

  return (
    <Button asChild size="sm" variant={actionTotal ? 'secondary' : 'ghost'}>
      <Link aria-label={inboxLabel} href="/dashboard/inbox">
        <IconInbox aria-hidden="true" />
        <span className="hidden lg:inline">
          {actionTotal ? `${actionCountLabel} to do` : 'Inbox'}
        </span>
        {actionTotal ? (
          <span
            aria-hidden="true"
            className="min-w-4 rounded-full bg-primary/14 px-1 font-mono text-[0.65rem] font-semibold leading-4 text-primary tabular-nums lg:hidden"
          >
            {actionCountLabel}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { address } = useAccount();
  const actionQueue = useActionQueue(address);
  const actionTotal = address ? actionQueue.data?.total : undefined;

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
          className="shrink-0 [&>[data-slot=button]]:px-3.5 [&>[data-slot=button]]:py-0"
        >
          <HeaderInboxLink actionTotal={actionTotal} />
          <Button asChild className="hidden sm:inline-flex" size="sm" variant="default">
            <Link href="/dashboard/drops">Latest Drop</Link>
          </Button>
          <PrivyHeaderAccountControl />
          <SkillInstallMenu className="hidden sm:inline-flex" />
          {showPostTaskCta ? (
            <Button asChild className="max-[360px]:hidden" size="sm">
              <Link href="/dashboard/tasks/new">Post a task</Link>
            </Button>
          ) : null}
        </ButtonGroup>
      </div>
    </header>
  );
}
