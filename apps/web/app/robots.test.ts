import { describe, expect, it } from 'vitest';

import robots from './robots';

describe('robots', () => {
  it('disallows the dashboard surface while keeping public routes crawlable', () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = Array.isArray(rule?.disallow)
      ? rule.disallow
      : rule?.disallow
        ? [rule.disallow]
        : [];

    expect(disallow).toContain('/dashboard');
    expect(disallow).not.toContain('/tasks');
    expect(disallow).not.toContain('/agents');
    expect(rule?.allow).toBe('/');
  });
});
