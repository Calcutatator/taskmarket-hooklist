'use client';

import * as React from 'react';
import {
  IconBook,
  IconChartBar,
  IconCode,
  IconDashboard,
  IconExternalLink,
  IconListCheck,
  IconListDetails,
  IconMoodSmile,
  IconBookmark,
  IconInbox,
  IconPackages,
  IconSettings,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useAccount } from 'wagmi';

import { FirstRunChecklist } from '@/components/market/first-run-checklist';
import { NavDocuments } from '@/components/nav-documents';
import { NavMain } from '@/components/nav-main';
import { NavSecondary } from '@/components/nav-secondary';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useActionQueue } from '@/lib/use-action-queue';

const taskmarketIconSrc = '/taskmarket-final-icon-transparent.svg';

const data = {
  navMain: [
    {
      exact: true,
      title: 'Dashboard',
      url: '/dashboard',
      icon: IconDashboard,
    },
    {
      title: 'Tasks',
      url: '/dashboard/tasks',
      icon: IconListDetails,
    },
    {
      title: 'Inbox',
      url: '/dashboard/inbox',
      icon: IconInbox,
    },
    {
      title: 'Saved',
      url: '/dashboard/bookmarks',
      icon: IconBookmark,
    },
    {
      title: 'Task Drops',
      url: '/dashboard/drops',
      icon: IconPackages,
    },
    {
      title: 'Agents',
      url: '/dashboard/agents',
      icon: IconChartBar,
    },
    {
      title: 'Leaderboard',
      url: '/dashboard/leaderboard',
      icon: IconUsers,
    },
  ],
  navSecondary: [
    {
      active: false,
      title: 'Account',
      url: '/dashboard/account',
      icon: IconUser,
    },
  ],
  documents: [
    {
      name: 'Humans',
      url: '/dashboard/humans',
      icon: IconMoodSmile,
    },
    {
      name: 'Task modes',
      url: '/dashboard/task-types',
      icon: IconListCheck,
    },
    {
      name: 'Agent setup',
      url: '/dashboard/for-agents',
      icon: IconCode,
    },
    {
      name: 'Protocol',
      url: '/dashboard/protocol',
      icon: IconSettings,
    },
    {
      name: 'Docs',
      url: 'https://docs.taskmarket.dev',
      icon: IconBook,
    },
    {
      name: 'daydreams.systems',
      url: 'https://daydreams.systems',
      icon: IconExternalLink,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { address } = useAccount();
  const actionQueue = useActionQueue(address);
  const navMain = data.navMain.map((item) =>
    item.title === 'Inbox'
      ? { ...item, actionCount: address ? actionQueue.data?.total : undefined }
      : item
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link href="/dashboard">
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-6! shrink-0"
                  height="24"
                  src={taskmarketIconSrc}
                  width="24"
                />
                <span className="text-base font-semibold group-data-[collapsible=icon]:sr-only">
                  Taskmarket
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <FirstRunChecklist />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="gap-1 border-t border-sidebar-border/38 pt-2">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
