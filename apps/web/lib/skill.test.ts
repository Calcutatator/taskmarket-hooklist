import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSiteUrl } from '@/lib/seo';
import {
  OPEN_MARKET_COMMAND,
  SKILLS_MARKET_URL,
  skillCurlInstallCommand,
  skillDocumentUrl,
  skillInstallCommands,
  skillNpxInstallCommand,
} from '@/lib/skill';

describe('skill install commands', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes the stable skills.sh package and npx command', () => {
    expect(SKILLS_MARKET_URL).toBe('https://skills.sh/daydreamsai/skills-market/taskmarket');
    expect(skillNpxInstallCommand()).toBe(
      'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket'
    );
  });

  it('builds the curl install command from the resolved site URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://market.example/');

    expect(getSiteUrl()).toBe('https://market.example');
    expect(skillCurlInstallCommand()).toBe(
      'curl -fsSL https://market.example/install-skill.sh | sh -s -- https://market.example'
    );
  });

  it('tracks the deployment site URL when the public override is absent', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_URL', 'preview.taskmarket.dev');

    expect(skillCurlInstallCommand()).toBe(
      'curl -fsSL https://preview.taskmarket.dev/install-skill.sh | sh -s -- https://preview.taskmarket.dev'
    );
  });

  it('attributes an install launched from a task detail page', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://taskmarket.dev');

    expect(skillCurlInstallCommand({ source: 'task-detail', taskId: 'task/1' })).toBe(
      "curl -fsSL 'https://taskmarket.dev/install-skill.sh?source=task-detail&taskId=task%2F1' | sh -s -- https://taskmarket.dev"
    );
  });

  it('returns both supported methods without dropping curl attribution', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://taskmarket.dev');

    expect(skillInstallCommands({ source: 'task-detail', taskId: 'task/1' })).toEqual({
      curl: "curl -fsSL 'https://taskmarket.dev/install-skill.sh?source=task-detail&taskId=task%2F1' | sh -s -- https://taskmarket.dev",
      npx: 'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket',
    });
  });

  it('exposes the shared marketplace command and skill document URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://taskmarket.dev');

    expect(OPEN_MARKET_COMMAND).toBe('taskmarket task list --status open');
    expect(skillDocumentUrl()).toBe('https://taskmarket.dev/skill.md');
  });
});
