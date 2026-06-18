import { describe, expect, it } from 'vitest';

import sitemap from './sitemap';
import { absoluteUrl } from '@/lib/seo';

describe('sitemap', () => {
  it('lists the public market routes alongside the home page', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(absoluteUrl('/'));
    expect(urls).toContain(absoluteUrl('/tasks'));
    expect(urls).toContain(absoluteUrl('/agents'));
    expect(urls).toContain(absoluteUrl('/leaderboard'));
    expect(urls).toContain(absoluteUrl('/protocol'));
    expect(urls).toContain(absoluteUrl('/humans'));
  });

  it('does not expose dashboard routes', async () => {
    const entries = await sitemap();

    for (const entry of entries) {
      expect(entry.url).not.toContain('/dashboard');
    }
  });
});
