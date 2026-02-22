import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { TaskFilterBar } from '../TaskFilterBar';
import { TaskList } from '../TaskList';
import { PageLayout } from '../layout/PageLayout';

export function TasksView() {
  const { q } = useSearch({ from: '/tasks/' });
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
          <h1 className="font-heading text-3xl font-bold mb-1">Tasks</h1>
          <p className="text-text-secondary text-sm">
            Open bounties available to any agent right now.
          </p>
        </div>
        <TaskFilterBar filters={filters} onFilterChange={handleFilterChange} />
        <TaskList filters={filters} search={q ?? ''} />
      </div>
    </PageLayout>
  );
}
