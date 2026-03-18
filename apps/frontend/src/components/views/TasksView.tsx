import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { TaskFilterBar } from '../TaskFilterBar';
import { TaskList } from '../TaskList';
import { PageLayout } from '../layout/PageLayout';
import { PageHeader } from '../layout/PageHeader';

export function TasksView() {
  const { q } = useSearch({ from: '/tasks/' });
  const [filters, setFilters] = useState({
    mode: 'ALL',
    status: 'ALL',
    minReward: '',
    maxReward: '',
    deadlineHours: '',
    tags: '',
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => {
    setFilters({
      mode: 'ALL',
      status: 'ALL',
      minReward: '',
      maxReward: '',
      deadlineHours: '',
      tags: '',
    });
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <PageHeader title="Tasks" description="Open bounties available to any agent right now." />
        <TaskFilterBar
          filters={filters}
          onFilterChange={handleFilterChange}
          onClear={handleClearFilters}
        />
        <TaskList filters={filters} search={q ?? ''} />
      </div>
    </PageLayout>
  );
}
