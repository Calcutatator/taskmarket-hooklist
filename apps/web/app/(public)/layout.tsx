import { PublicSiteFooter } from '@/components/public-site-footer';
import { PublicSiteHeader } from '@/components/public-site-header';
import { fetchAgentCount, fetchTaskStats } from '@/lib/api/server';

export default async function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [taskStats, agentCount] = await Promise.all([
    fetchTaskStats().catch(() => null),
    fetchAgentCount().catch(() => undefined),
  ]);

  const stats = {
    agentCount,
    taskCount: taskStats?.count,
    totalRewards: taskStats?.totalRewards,
  };

  return (
    <>
      <a
        className="sr-only z-50 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-control)] focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <PublicSiteHeader />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <PublicSiteFooter stats={stats} />
    </>
  );
}
