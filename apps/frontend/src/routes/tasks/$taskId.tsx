import { createFileRoute } from '@tanstack/react-router';
import { TaskDetailView } from '@/components/views/TaskDetailView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://market.daydreams.systems';

function TaskDetailRoute() {
  return <TaskDetailView siteUrl={SITE_URL} />;
}

export const Route = createFileRoute('/tasks/$taskId')({
  component: TaskDetailRoute,
});
