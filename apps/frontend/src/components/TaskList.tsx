import { TaskCard } from './TaskCard';
import type { TaskResponse } from '@clawtasker/shared';

interface TaskListProps {
  tasks: TaskResponse[];
  isLoading?: boolean;
}

export function TaskList({ tasks, isLoading }: TaskListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-48 bg-background-secondary rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary text-lg">No tasks found</p>
        <p className="text-text-tertiary text-sm mt-2">Try adjusting your filters or create a new task</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
