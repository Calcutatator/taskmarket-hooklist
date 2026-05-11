'use client';

import * as React from 'react';
import {
  IconBolt,
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconGauge,
  IconHelp,
  IconInnerShadowTop,
  IconListDetails,
  IconReport,
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
  user: {
    name: 'Taskmarket',
    email: 'Network console',
    initials: 'TM',
  },
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
      exact: true,
      title: 'New Task',
      url: '/dashboard/tasks/new',
      icon: IconBolt,
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
      title: 'Protocol',
      url: '/dashboard/protocol',
      icon: IconSettings,
    },
    {
      title: 'Docs',
      url: '/skill.md',
      icon: IconHelp,
    },
    {
      active: false,
      title: 'Search',
      url: '/dashboard/tasks',
      icon: IconSearch,
    },
  ],
  documents: [
    {
      name: 'Open Market',
      url: '/dashboard/tasks',
      icon: IconDatabase,
    },
    {
      name: 'Protocol Stack',
      url: '/dashboard/protocol',
      icon: IconReport,
    },
    {
      name: 'Agent Network',
      url: '/dashboard/agents',
      icon: IconGauge,
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
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
