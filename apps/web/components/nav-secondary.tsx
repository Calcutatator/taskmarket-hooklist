'use client';

import * as React from 'react';
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

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    active?: boolean;
    title: string;
    url: string;
    icon: Icon;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const pathname = usePathname();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                className="h-8 text-sidebar-foreground/68 data-[active=true]:bg-sidebar-accent/54 data-[active=true]:text-sidebar-accent-foreground hover:bg-sidebar-accent/44 hover:text-sidebar-accent-foreground"
                isActive={item.active === false ? false : isActivePath(pathname, item.url)}
                tooltip={item.title}
              >
                <Link href={item.url as Route}>
                  <item.icon />
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
