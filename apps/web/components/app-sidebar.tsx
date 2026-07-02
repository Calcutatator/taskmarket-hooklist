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
  IconNews,
  IconSettings,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import Link from 'next/link';

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
      // The route path stays /dashboard/inbox to avoid breaking existing links;
      // only the user-facing label changed to News. A /dashboard/news alias could
      // be added later if a cleaner URL is wanted.
      name: 'News',
      url: '/dashboard/inbox',
      icon: IconNews,
    },
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
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="gap-1 border-t border-sidebar-border/38 pt-2">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
