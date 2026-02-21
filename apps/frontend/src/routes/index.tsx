import { createFileRoute } from '@tanstack/react-router';
import { TaskListView } from '@/components/views/TaskListView';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  component: TaskListView,
});
