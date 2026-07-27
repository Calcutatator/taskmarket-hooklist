import type { TaskResponse } from '@taskmarket/shared';

const TASK_TITLE_MAX_LENGTH = 80;

type TaskTitleSource = Pick<TaskResponse, 'description' | 'id'>;

function firstLineTitle(task: TaskTitleSource): string | null {
  const firstLine = (task.description.split('\n')[0] ?? '')
    .replace(/^#+\s*/, '')
    .replace(/[*`]/g, '')
    .trim();
  return firstLine || null;
}

export function taskTitle(task: TaskTitleSource) {
  const firstLine = firstLineTitle(task);
  if (!firstLine) return `Task ${task.id}`;
  if (firstLine.length <= TASK_TITLE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, TASK_TITLE_MAX_LENGTH - 1)}…`;
}

export function taskFullTitle(task: TaskTitleSource) {
  return firstLineTitle(task) ?? `Task ${task.id}`;
}
