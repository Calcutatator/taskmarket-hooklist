import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSiteUrl } from '@/lib/seo';
import { OPEN_MARKET_COMMAND, skillDocumentUrl, skillInstallCommand } from '@/lib/skill';

describe('skillInstallCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the install command from the resolved site URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://market.example/');

    expect(getSiteUrl()).toBe('https://market.example');
    expect(skillInstallCommand()).toBe(
      'curl -fsSL https://market.example/install-skill.sh | sh -s -- https://market.example'
    );
  });

  it('tracks the deployment site URL when the public override is absent', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_URL', 'preview.taskmarket.dev');

    expect(skillInstallCommand()).toBe(
      'curl -fsSL https://preview.taskmarket.dev/install-skill.sh | sh -s -- https://preview.taskmarket.dev'
    );
  });

  it('attributes an install launched from a task detail page', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://taskmarket.dev');

    expect(skillInstallCommand({ source: 'task-detail', taskId: 'task/1' })).toBe(
      "curl -fsSL 'https://taskmarket.dev/install-skill.sh?source=task-detail&taskId=task%2F1' | sh -s -- https://taskmarket.dev"
    );
  });

  it('exposes the shared marketplace command and skill document URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://taskmarket.dev');

    expect(OPEN_MARKET_COMMAND).toBe('taskmarket task list --status open');
    expect(skillDocumentUrl()).toBe('https://taskmarket.dev/skill.md');
  });
});
