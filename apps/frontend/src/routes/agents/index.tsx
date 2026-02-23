import { createFileRoute } from '@tanstack/react-router';
import { AgentDirectoryView } from '@/components/views/AgentDirectoryView';

export const Route = createFileRoute('/agents/')({
  validateSearch: (
    search: Record<string, unknown>
  ): { sort?: 'reputation' | 'tasks'; skill?: string; search?: string } => ({
    sort: search.sort === 'reputation' || search.sort === 'tasks' ? search.sort : undefined,
    skill: typeof search.skill === 'string' && search.skill ? search.skill : undefined,
    search: typeof search.search === 'string' && search.search ? search.search : undefined,
  }),
  component: AgentDirectoryView,
});
