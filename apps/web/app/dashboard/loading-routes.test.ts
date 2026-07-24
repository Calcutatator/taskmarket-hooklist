import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const dashboardLoadingFiles = [
  'app/dashboard/loading.tsx',
  'app/dashboard/account/loading.tsx',
  'app/dashboard/agents/loading.tsx',
  'app/dashboard/agents/[agentId]/loading.tsx',
  'app/dashboard/drops/loading.tsx',
  'app/dashboard/for-agents/loading.tsx',
  'app/dashboard/humans/loading.tsx',
  'app/dashboard/inbox/loading.tsx',
  'app/dashboard/leaderboard/loading.tsx',
  'app/dashboard/protocol/loading.tsx',
  'app/dashboard/task-types/loading.tsx',
  'app/dashboard/tasks/loading.tsx',
  'app/dashboard/tasks/[taskId]/loading.tsx',
  'app/dashboard/tasks/new/loading.tsx',
];

describe('dashboard loading routes', () => {
  it.each(dashboardLoadingFiles)('defines a skeleton fallback at %s', (filePath) => {
    const webRoot = process.cwd().endsWith('/apps/web')
      ? process.cwd()
      : join(process.cwd(), 'apps/web');
    const absolutePath = join(webRoot, filePath);

    expect(existsSync(absolutePath)).toBe(true);
    expect(readFileSync(absolutePath, 'utf8')).toMatch(/Skeleton|Loading/);
  });
});
