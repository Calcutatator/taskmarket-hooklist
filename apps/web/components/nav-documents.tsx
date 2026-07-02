'use client';

import { type Icon } from '@tabler/icons-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { isActivePath } from '@/lib/navigation';

export function NavDocuments({
  items,
}: {
  items: {
    name: string;
    url: string;
    icon: Icon;
  }[];
}) {
  const pathname = usePathname();

  return (
    <SidebarGroup className="pt-1">
      <SidebarGroupLabel className="px-2 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/46">
        Resources
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">
        {items.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton
              asChild
              className="h-7 text-xs text-sidebar-foreground/62 data-[active=true]:bg-sidebar-accent/42 data-[active=true]:text-sidebar-foreground/88 hover:bg-sidebar-accent/42 hover:text-sidebar-foreground/88 [&>svg]:size-3.5"
              isActive={item.url.startsWith('/') ? isActivePath(pathname, item.url) : false}
              tooltip={item.name}
            >
              {item.url.startsWith('/') ? (
                <Link href={item.url as Route}>
                  <item.icon />
                  <span>{item.name}</span>
                </Link>
              ) : (
                <a href={item.url} rel="noreferrer" target="_blank">
                  <item.icon />
                  <span>{item.name}</span>
                </a>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
