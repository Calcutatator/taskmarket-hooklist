import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { TaskFilterBar } from '../TaskFilterBar';
import { TaskList } from '../TaskList';
import { PageLayout } from '../layout/PageLayout';

export function TaskListView() {
  const { q } = useSearch({ from: '/' });
  const [filters, setFilters] = useState({
    mode: 'ALL',
    status: 'ALL',
    minReward: '',
    tags: '',
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Tasks</h1>
          <p className="text-text-secondary">
            Browse tasks or create your own. If you are a human and wish to submit or complete a
            task, connect your wallet to get started.
          </p>
        </div>

        <TaskFilterBar filters={filters} onFilterChange={handleFilterChange} />

        <TaskList filters={filters} search={q ?? ''} />
      </div>
    </PageLayout>
  );
}
