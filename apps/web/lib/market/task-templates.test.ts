import { describe, expect, it } from 'vitest';
import {
  composeBrief,
  DEFAULT_TEMPLATE_ID,
  findTemplate,
  type TaskTemplate,
} from './task-templates';

function templateWith(
  sections: TaskTemplate['brief'],
  tokens: TaskTemplate['tokens']
): TaskTemplate {
  return {
    id: 'custom',
    label: 'Test',
    shortDescription: 'Test template',
    icon: findTemplate('logo')!.icon,
    mode: 'bounty',
    suggestedRewardUsdc: '',
    suggestedDurationHours: 72,
    suggestedTags: [],
    tokens,
    brief: sections,
    briefSource: 'static',
  };
}

describe('composeBrief', () => {
  it('fills tokens from user values', () => {
    const template = templateWith(
      [{ heading: 'Goal', body: 'Design a logo for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', defaultValue: 'our brand' }]
    );
    const result = composeBrief(template, { brand: 'Acme Labs' });
    expect(result).toBe('Goal\nDesign a logo for Acme Labs.');
  });

  it('falls back to the token defaultValue when no user value is given', () => {
    const template = templateWith(
      [{ heading: 'Goal', body: 'Design a logo for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', defaultValue: 'our brand' }]
    );
    const result = composeBrief(template, {});
    expect(result).toBe('Goal\nDesign a logo for our brand.');
  });

  it('strips tokens that are unfilled and have no default', () => {
    const template = templateWith(
      [{ heading: 'Goal', body: 'Design a logo for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme' }]
    );
    const result = composeBrief(template, {});
    expect(result).toBe('Goal\nDesign a logo for .');
    expect(result).not.toContain('{{brand}}');
  });

  it('treats a blank user value as unfilled and falls back to the default', () => {
    const template = templateWith(
      [{ heading: 'Goal', body: 'For {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', defaultValue: 'our brand' }]
    );
    const result = composeBrief(template, { brand: '   ' });
    expect(result).toBe('Goal\nFor our brand.');
  });

  it('joins sections with a blank line and collapses extra newlines', () => {
    const template = templateWith(
      [
        { heading: 'Goal', body: 'Line one.\n\n\nLine two.' },
        { heading: 'Review', body: 'Final review.' },
      ],
      []
    );
    const result = composeBrief(template, {});
    expect(result).toBe('Goal\nLine one.\n\nLine two.\n\nReview\nFinal review.');
    expect(result).not.toContain('\n\n\n');
  });

  it('clamps the composed brief to 2000 characters', () => {
    const template = templateWith([{ heading: 'Goal', body: 'x'.repeat(5000) }], []);
    const result = composeBrief(template, {});
    expect(result.length).toBe(2000);
  });
});

describe('findTemplate', () => {
  it('returns the matching template by id', () => {
    expect(findTemplate('logo')?.id).toBe('logo');
  });

  it('returns undefined for an unknown id', () => {
    expect(findTemplate('does-not-exist')).toBeUndefined();
  });
});

describe('DEFAULT_TEMPLATE_ID', () => {
  it('points at the custom template', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('custom');
    expect(findTemplate(DEFAULT_TEMPLATE_ID)).toBeDefined();
  });
});
