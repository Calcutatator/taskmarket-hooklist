// Implements: ADR-0041
import { z } from 'zod';

const OPEN_TASK_LIMIT = 10;
const OPEN_TASK_DROP_LIMIT = 10;

const PublicTaskSchema = z.object({
  description: z.string(),
  expiryTime: z.string(),
  id: z.string(),
  mode: z.string(),
  reward: z.string().regex(/^\d+$/),
  status: z.string(),
  tags: z.array(z.string()),
  taskVisibility: z.enum(['public', 'unlisted', 'private']),
});

const PublicDropSchema = z.object({
  drop: z.object({
    id: z.string(),
    name: z.string(),
  }),
  tasks: z.array(
    z.object({
      description: z.string(),
      id: z.string(),
      mode: z.string(),
      reward: z.string().regex(/^\d+$/),
      status: z.string(),
    })
  ),
});

const PublicTaskListSchema = z.object({
  tasks: z.array(PublicTaskSchema),
});

const PublicTaskDropDirectorySchema = z.object({
  items: z.array(
    z.object({
      availableTaskCount: z.number().int().nonnegative(),
      drop: z.object({
        id: z.string(),
        name: z.string(),
      }),
    })
  ),
});

export type PublicTask = z.infer<typeof PublicTaskSchema>;
export type PublicDrop = z.infer<typeof PublicDropSchema>;
export type PublicTaskDropDirectoryItem = z.infer<
  typeof PublicTaskDropDirectorySchema
>['items'][number];

export class TaskmarketUnavailableError extends Error {
  constructor() {
    super('Taskmarket is temporarily unavailable');
    this.name = 'TaskmarketUnavailableError';
  }
}

export class TaskmarketClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 2_000
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getTask(taskId: string): Promise<PublicTask | null> {
    const task = await this.getJson(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (task === null) return null;

    const parsed = PublicTaskSchema.safeParse(task);
    if (!parsed.success) throw new TaskmarketUnavailableError();
    return parsed.data.taskVisibility === 'public' ? parsed.data : null;
  }

  async getOpenTasksByReward(): Promise<PublicTask[]> {
    const result = await this.getJson(
      `/api/tasks?status=open&sort=reward_desc&limit=${OPEN_TASK_LIMIT}`
    );
    const parsed = PublicTaskListSchema.safeParse(result);
    if (!parsed.success) throw new TaskmarketUnavailableError();

    return parsed.data.tasks
      .filter((task) => task.taskVisibility === 'public' && task.status === 'open')
      .slice(0, OPEN_TASK_LIMIT);
  }

  async getOpenTaskDrops(): Promise<PublicTaskDropDirectoryItem[]> {
    const result = await this.getJson(`/api/task-drops/directory?limit=${OPEN_TASK_DROP_LIMIT}`);
    const parsed = PublicTaskDropDirectorySchema.safeParse(result);
    if (!parsed.success) throw new TaskmarketUnavailableError();

    return parsed.data.items
      .filter((item) => item.availableTaskCount > 0)
      .slice(0, OPEN_TASK_DROP_LIMIT);
  }

  async getDrop(dropId: string): Promise<PublicDrop | null> {
    const drop = await this.getJson(`/api/task-drops/${encodeURIComponent(dropId)}`);
    if (drop === null) return null;

    const parsed = PublicDropSchema.safeParse(drop);
    if (!parsed.success) throw new TaskmarketUnavailableError();
    return parsed.data.tasks.length > 0 ? parsed.data : null;
  }

  private async getJson(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        method: 'GET',
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new TaskmarketUnavailableError();
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof TaskmarketUnavailableError) throw error;
      throw new TaskmarketUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
