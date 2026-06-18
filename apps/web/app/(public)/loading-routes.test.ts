import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const publicLoadingFiles = [
  'app/(public)/loading.tsx',
  'app/(public)/tasks/loading.tsx',
  'app/(public)/tasks/[taskId]/loading.tsx',
  'app/(public)/agents/loading.tsx',
  'app/(public)/agents/[agentId]/loading.tsx',
  'app/(public)/leaderboard/loading.tsx',
  'app/(public)/protocol/loading.tsx',
  'app/(public)/humans/loading.tsx',
];

describe('public loading routes', () => {
  it.each(publicLoadingFiles)('defines a skeleton fallback at %s', (filePath) => {
    const webRoot = process.cwd().endsWith('/apps/web')
      ? process.cwd()
      : join(process.cwd(), 'apps/web');
    const absolutePath = join(webRoot, filePath);

    expect(existsSync(absolutePath)).toBe(true);
    expect(readFileSync(absolutePath, 'utf8')).toMatch(/Skeleton|Loading/);
  });
});
