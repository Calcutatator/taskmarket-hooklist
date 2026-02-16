import { createFileRoute } from '@tanstack/react-router';
import { CreateTaskView } from '@/components/views/CreateTaskView';

export const Route = createFileRoute('/tasks/new')({
  component: CreateTaskView,
});
