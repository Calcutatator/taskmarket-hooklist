import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSiteUrl } from '@/lib/seo';
import { skillInstallCommand } from '@/lib/skill';

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
});
