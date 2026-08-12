import type { Metadata } from 'next';

import { CreateTaskWizard } from '@/components/market/create-task-wizard';
import { fetchMarketStats, type MarketStats } from '@/lib/api/server';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Create and fund a Taskmarket task with a mode, reward, brief, and signing terms.',
  ownOgImage: true,
  path: '/dashboard/tasks/new',
  title: 'Create a task',
});

// The market signal is decorative: never let it delay (or block) the wizard.
// Take whichever resolves first - the stats or a short fallback to null.
async function loadMarketStats(): Promise<MarketStats | null> {
  return Promise.race([
    fetchMarketStats().catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 1_500);
    }),
  ]);
}

export default async function NewTaskPage() {
  const initialMarketStats = await loadMarketStats();

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Create a task</h1>
      <CreateTaskWizard initialMarketStats={initialMarketStats} />
    </div>
  );
}
