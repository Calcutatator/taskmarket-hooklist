'use client';

import { type Icon } from '@tabler/icons-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { isActivePath } from '@/lib/navigation';

export function NavMain({
  items,
}: {
  items: {
    exact?: boolean;
    actionCount?: number;
    title: string;
    url: string;
    icon?: Icon;
  }[];
}) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                className="h-9 font-semibold text-sidebar-foreground/84 data-[active=true]:bg-sidebar-accent/72 data-[active=true]:text-sidebar-accent-foreground hover:bg-sidebar-accent/58 hover:text-sidebar-accent-foreground"
                isActive={isActivePath(pathname, item.url, item.exact)}
                tooltip={item.title}
              >
                <Link
                  aria-label={
                    item.actionCount === undefined
                      ? undefined
                      : item.actionCount === 0
                        ? `${item.title}, no actions to do`
                        : `${item.title}, ${item.actionCount} ${item.actionCount === 1 ? 'action' : 'actions'} to do`
                  }
                  href={item.url as Route}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {item.actionCount ? (
                <SidebarMenuBadge
                  aria-hidden="true"
                  className="bg-primary/12 font-mono text-primary group-data-[collapsible=icon]:right-0! group-data-[collapsible=icon]:top-0! group-data-[collapsible=icon]:flex! group-data-[collapsible=icon]:size-2! group-data-[collapsible=icon]:min-w-2! group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-[0px]"
                >
                  {item.actionCount > 99 ? '99+' : item.actionCount}
                </SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
