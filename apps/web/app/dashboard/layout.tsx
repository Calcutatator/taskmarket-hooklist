import type { Metadata } from 'next';

import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata();

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <a
        className="sr-only z-50 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-control)] focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
        href="#dashboard-content"
      >
        Skip to dashboard content
      </a>
      <AppSidebar variant="inset" />
      <SidebarInset id="dashboard-content" tabIndex={-1}>
        <SiteHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
