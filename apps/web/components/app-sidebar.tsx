'use client';

import * as React from 'react';
import {
  IconBook,
  IconChartBar,
  IconCode,
  IconDashboard,
  IconExternalLink,
  IconInbox,
  IconListCheck,
  IconListDetails,
  IconMoodSmile,
  IconSearch,
  IconSettings,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';

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
      title: 'Inbox',
      url: '/dashboard/inbox',
      icon: IconInbox,
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
      title: 'Humans',
      url: '/dashboard/humans',
      icon: IconMoodSmile,
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
      title: 'Task search',
      url: '/dashboard/tasks',
      icon: IconSearch,
    },
    {
      active: false,
      title: 'Account',
      url: '/dashboard/account',
      icon: IconUser,
    },
  ],
  documents: [
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
      url: 'https://docs-market.daydreams.systems',
      icon: IconBook,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <a href="/dashboard">
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-6! shrink-0"
                  height="24"
                  src={taskmarketIconSrc}
                  width="24"
                />
                <span className="text-base font-semibold">Taskmarket</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="text-sidebar-foreground/72 hover:text-sidebar-foreground"
            >
              <a href="https://daydreams.systems" rel="noreferrer" target="_blank">
                <IconExternalLink className="size-4" />
                <span>daydreams.systems</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
