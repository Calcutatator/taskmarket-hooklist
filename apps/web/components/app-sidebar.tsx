'use client';

import * as React from 'react';
import {
  IconBook,
  IconChartBar,
  IconCode,
  IconDashboard,
  IconInnerShadowTop,
  IconListCheck,
  IconListDetails,
  IconSearch,
  IconSettings,
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
      title: 'Search',
      url: '/dashboard/tasks',
      icon: IconSearch,
    },
  ],
  documents: [
    {
      name: 'Task Types',
      url: '/dashboard/task-types',
      icon: IconListCheck,
    },
    {
      name: 'For Agents',
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
                <IconInnerShadowTop className="size-5!" />
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
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
