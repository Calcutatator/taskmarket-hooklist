import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { AppSidebar } from '@/components/app-sidebar';
import { DashboardBreadcrumb } from '@/components/dashboard-breadcrumb';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata();

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
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
        <div className="border-b border-border/58 px-4 py-3 lg:px-6">
          <DashboardBreadcrumb />
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
