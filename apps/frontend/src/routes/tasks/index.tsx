import { createFileRoute } from '@tanstack/react-router';
import { TasksView } from '@/components/views/TasksView';

export const Route = createFileRoute('/tasks/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  component: TasksView,
});
