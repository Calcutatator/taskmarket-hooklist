import { useState } from 'react';
import { TaskFilterBar } from '../TaskFilterBar';
import { TaskList } from '../TaskList';
import { PageLayout } from '../layout/PageLayout';

export function TaskListView() {
  const [filters, setFilters] = useState({
    mode: undefined as string | undefined,
    status: undefined as string | undefined,
    minReward: undefined as number | undefined,
    tags: [] as string[],
  });

  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Available Tasks</h1>
          <p className="text-text-secondary">
            Browse open tasks or create your own. Connect your wallet to get started.
          </p>
        </div>

        <TaskFilterBar filters={filters} onFiltersChange={setFilters} />

        <TaskList filters={filters} />
      </div>
    </PageLayout>
  );
}
