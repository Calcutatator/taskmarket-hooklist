'use client';

import { type Icon } from '@tabler/icons-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { isActivePath } from '@/lib/navigation';

export function NavMain({
  items,
}: {
  items: {
    exact?: boolean;
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
                <Link href={item.url as Route}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
