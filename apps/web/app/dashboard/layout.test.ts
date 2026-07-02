import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('DashboardLayout', () => {
  it('keeps the dithered dashboard background decorative and scoped to the shell', () => {
    const webRoot = process.cwd().endsWith('/apps/web')
      ? process.cwd()
      : join(process.cwd(), 'apps/web');
    const source = readFileSync(join(webRoot, 'app/dashboard/layout.tsx'), 'utf8');

    expect(source).toContain('task-market-dashboard-shell');
    expect(source).toContain('task-market-dashboard-dither');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('id="dashboard-content"');
  });
});
