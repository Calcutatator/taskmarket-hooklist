import { createFileRoute } from '@tanstack/react-router';
import { TaskListView } from '@/components/views/TaskListView';

export const Route = createFileRoute('/')({
  component: TaskListView,
});
