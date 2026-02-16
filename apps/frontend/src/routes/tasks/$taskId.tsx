import { createFileRoute } from '@tanstack/react-router';
import { TaskDetailView } from '@/components/views/TaskDetailView';

export const Route = createFileRoute('/tasks/$taskId')({
  component: TaskDetailView,
});
