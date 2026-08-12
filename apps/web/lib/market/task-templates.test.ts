import { TaskCreateSchema } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { buildCreateTaskPayload, DEFAULT_FORM_VALUES } from './create-task-form';
import { transitionTemplateChoice } from './task-template-transition';
import templateCatalogue from './task-templates.json';
import {
  composeBrief,
  composedTemplateTitle,
  DEFAULT_TEMPLATE_ID,
  findTemplate,
  isTemplateReadinessValueValid,
  type TaskTemplate,
  taskTemplates,
  templatesForMode,
  validateTaskTemplateCatalogue,
} from './task-templates';

function templateWith(
  sections: TaskTemplate['brief'],
  tokens: TaskTemplate['tokens'],
  titleTemplate = 'Design a logo for {{brand}}'
): TaskTemplate {
  return {
    ...findTemplate('logo')!,
    label: 'Test',
    shortDescription: 'Test template',
    titleTemplate,
    tokens,
    brief: sections,
  };
}

describe('composeBrief', () => {
  it('uses a concrete composed first line as the marketplace title', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'Create a production-ready identity for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', required: true }]
    );
    const result = composeBrief(template, { brand: 'Acme Labs' });
    expect(result).toBe(
      'Design a logo for Acme Labs\n\nOutcome\nCreate a production-ready identity for Acme Labs.'
    );
  });

  it('preserves an overlong composed title so readiness validation can block it', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'Create a production-ready identity for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', required: true }]
    );
    const result = composeBrief(template, { brand: 'A'.repeat(120) });
    const [title] = result.split('\n');
    expect(title!.length).toBeGreaterThan(80);
    expect(title).not.toMatch(/…$/);
    expect(composedTemplateTitle(template, { brand: 'A'.repeat(120) })).toBe(title);
  });

  it('composes resolved readiness values into the public worker prompt', () => {
    const template = templateWith(
      [
        { heading: 'Outcome', body: 'Create a production-ready identity for {{brand}}.' },
        { heading: 'Public inputs', body: '- Brand pack: {{brandPack}}.' },
      ],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', required: true }]
    );
    template.readiness = [
      {
        help: 'A public URL that opens without sign-in.',
        input: 'url',
        key: 'brandPack',
        label: 'Public brand pack',
        placeholder: 'https://example.com/brand',
        publicAccess: 'required',
        required: true,
      },
    ];

    expect(
      composeBrief(
        template,
        { brand: 'Acme Labs' },
        { brandPack: 'https://example.com/acme-brand' }
      )
    ).toContain('- Brand pack: https://example.com/acme-brand.');
  });

  it('renders an explicit prompt when a token is not filled', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'Design a logo for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', required: true }]
    );
    const result = composeBrief(template, {});
    expect(result).toBe(
      'Design a logo for [Add: Brand]\n\nOutcome\nDesign a logo for [Add: Brand].'
    );
  });

  it('does not leave raw template syntax in an unfilled brief', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'Design a logo for {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', required: true }]
    );
    const result = composeBrief(template, {});
    expect(result).toBe(
      'Design a logo for [Add: Brand]\n\nOutcome\nDesign a logo for [Add: Brand].'
    );
    expect(result).not.toContain('{{brand}}');
  });

  it('treats a blank user value as unfilled', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'For {{brand}}.' }],
      [{ key: 'brand', label: 'Brand', placeholder: 'Acme', required: true }]
    );
    const result = composeBrief(template, { brand: '   ' });
    expect(result).toBe('Design a logo for [Add: Brand]\n\nOutcome\nFor [Add: Brand].');
  });

  it('uses an approved truthful fallback for an optional token', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'Use a {{style}} direction.' }],
      [
        {
          defaultValue: 'designer-led, with a clear rationale',
          key: 'style',
          label: 'Style',
          placeholder: 'Minimal',
          required: false,
        },
      ],
      'Use the approved visual direction'
    );
    expect(composeBrief(template, {})).toBe(
      'Use the approved visual direction\n\nOutcome\nUse a designer-led, with a clear rationale direction.'
    );
  });

  it('joins sections with a blank line and collapses extra newlines', () => {
    const template = templateWith(
      [
        { heading: 'Outcome', body: 'Line one.\n\n\nLine two.' },
        { heading: 'How selection works', body: 'Final review.' },
      ],
      [],
      'Test task'
    );
    const result = composeBrief(template, {});
    expect(result).toBe(
      'Test task\n\nOutcome\nLine one.\n\nLine two.\n\nHow selection works\nFinal review.'
    );
    expect(result).not.toContain('\n\n\n');
  });

  it('preserves an oversized composed brief for form validation instead of truncating it', () => {
    const template = templateWith(
      [{ heading: 'Outcome', body: 'x'.repeat(15000) }],
      [],
      'Test task'
    );
    const result = composeBrief(template, {});
    expect(result.length).toBeGreaterThan(10000);
    expect(result).toContain('x'.repeat(15000));
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

describe('isTemplateReadinessValueValid', () => {
  it('requires a no-login confirmation for credential-free public HTTP URLs', () => {
    const item = findTemplate('bug-fix')!.readiness[0]!;
    expect(isTemplateReadinessValueValid(item, 'https://github.com/org/repo/issues/1')).toBe(false);
    expect(isTemplateReadinessValueValid(item, 'https://github.com/org/repo/issues/1', true)).toBe(
      true
    );
    expect(isTemplateReadinessValueValid(item, 'not-a-url')).toBe(false);
    expect(isTemplateReadinessValueValid(item, 'ftp://example.com/task-pack')).toBe(false);
    expect(isTemplateReadinessValueValid(item, 'https://user:secret@example.com/task-pack')).toBe(
      false
    );
  });
});

describe('taskTemplates', () => {
  it('loads three authored templates for every task mode', () => {
    expect(taskTemplates).toHaveLength(15);
    expect(templatesForMode('bounty').map((template) => template.id)).toEqual([
      'logo',
      'infographic',
      'landing-copy',
    ]);
    expect(templatesForMode('claim').map((template) => template.id)).toEqual([
      'bug-fix',
      'content-migration',
      'dataset-cleanup',
    ]);
    expect(templatesForMode('pitch').map((template) => template.id)).toEqual([
      'ai-integration',
      'ux-ui-redesign',
      'go-to-market',
    ]);
    expect(templatesForMode('benchmark').map((template) => template.id)).toEqual([
      'prompt-eval',
      'api-latency',
      'data-extraction',
    ]);
    expect(templatesForMode('auction').map((template) => template.id)).toEqual([
      'data-labeling',
      'cross-browser-qa',
      'data-entry',
    ]);
  });

  it('keeps rewards out of the authored catalogue', () => {
    expect(taskTemplates.every((template) => !('reward' in template))).toBe(true);
  });

  it('keeps authored briefs within the approved detail range', () => {
    for (const template of taskTemplates) {
      const length = template.brief.map((section) => section.body).join('\n\n').length;
      expect(length, template.id).toBeGreaterThanOrEqual(2_000);
      expect(length, template.id).toBeLessThanOrEqual(6_000);
    }
  });

  it('loads the exact mode defaults used by the protocol-specific families', () => {
    const claim = findTemplate('bug-fix');
    const benchmark = findTemplate('prompt-eval');
    const auction = findTemplate('data-labeling');
    expect(claim?.mode).toBe('claim');
    expect(benchmark?.mode).toBe('benchmark');
    expect(auction?.mode).toBe('auction');
    if (!claim || claim.mode !== 'claim' || !benchmark || benchmark.mode !== 'benchmark') {
      throw new Error('Expected mode-specific fixtures.');
    }
    if (!auction || auction.mode !== 'auction') {
      throw new Error('Expected Auction fixture.');
    }
    expect(claim.modeDefaults).toEqual({
      stakeBps: '0',
      stakeRequired: false,
    });
    expect(benchmark.modeDefaults).toEqual({
      metricDescription: 'Held-out pass rate in basis points (0-10000); higher is better.',
      metricTarget:
        'Exceed the published baseline; tie-break lower median token cost, then lower p95 latency.',
    });
    expect(auction.modeDefaults).toEqual({
      auctionType: 'reverse_english',
      bidDeadline: '48',
    });
  });

  it('keeps every mode-specific default within its protocol-safe boundary', () => {
    for (const template of taskTemplates) {
      if (template.mode === 'claim') {
        expect(template.modeDefaults, template.id).toEqual({
          stakeBps: '0',
          stakeRequired: false,
        });
      }
      if (template.mode === 'pitch') {
        expect(Number(template.modeDefaults.pitchDeadline), template.id).toBeGreaterThan(0);
        expect(Number(template.modeDefaults.pitchDeadline), template.id).toBeLessThan(
          template.durationHours
        );
      }
      if (template.mode === 'benchmark') {
        expect(template.modeDefaults.metricDescription.length, template.id).toBeGreaterThan(0);
        expect(template.modeDefaults.metricTarget.length, template.id).toBeGreaterThan(0);
      }
      if (template.mode === 'auction') {
        expect(['english', 'reverse_english'], template.id).toContain(
          template.modeDefaults.auctionType
        );
        expect(Number(template.modeDefaults.bidDeadline), template.id).toBeGreaterThan(0);
        expect(Number(template.modeDefaults.bidDeadline), template.id).toBeLessThan(
          template.durationHours
        );
      }
    }
  });

  it('builds a schema-valid create payload from every authored template', () => {
    for (const template of taskTemplates) {
      const transition = transitionTemplateChoice({
        current: DEFAULT_FORM_VALUES,
        mode: template.mode,
        templateId: template.id,
      });
      const tokenValues = Object.fromEntries(
        template.tokens.map((token) => [token.key, `Fixture ${token.label}`])
      );
      const values = {
        ...transition.values,
        description: composeBrief(
          template,
          tokenValues,
          Object.fromEntries(
            template.readiness.map((item) => [
              item.key,
              item.input === 'url'
                ? `https://example.com/${template.id}/${item.key}`
                : `Fixture ${item.label}`,
            ])
          )
        ),
        reward: '25',
      };
      const parsed = TaskCreateSchema.safeParse(buildCreateTaskPayload(values));
      expect(parsed.success, template.id).toBe(true);
    }
  });

  it('composes every authored template as a resolved public cold-start prompt', () => {
    for (const template of taskTemplates) {
      const tokenValues = Object.fromEntries(
        template.tokens.map((token) => [token.key, `Example ${token.label}`])
      );
      const readinessValues = Object.fromEntries(
        template.readiness.map((item) => [
          item.key,
          item.input === 'url'
            ? `https://example.com/${template.id}/${item.key}`
            : `Public ${item.label}`,
        ])
      );
      const description = composeBrief(template, tokenValues, readinessValues);
      const [title] = description.split('\n');

      expect(title, template.id).toBeTruthy();
      expect(title!.length, template.id).toBeLessThanOrEqual(80);
      expect(title, template.id).not.toMatch(
        /^(Outcome|Public inputs|Readiness gate|Deliverables|Acceptance|Evidence|Boundaries|How selection works)$/
      );
      expect(description, template.id).toContain('\n\nPublic inputs\n');
      expect(description, template.id).toContain('\n\nReadiness gate\n');
      expect(description, template.id).not.toMatch(/\{\{|\[Add:/);
      expect(description, template.id).not.toMatch(
        /before publication|before publishing|provided later|shared after|assigned automatically|after 48 hours|first 24 hours/i
      );
    }
  });

  it('rejects unknown catalogue fields instead of silently stripping them', () => {
    const invalid = structuredClone(templateCatalogue) as Array<Record<string, unknown>>;
    invalid[0].reward = '2';
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow();
  });

  it('rejects a supported template id assigned to the wrong mode', () => {
    const invalid = structuredClone(templateCatalogue) as Array<Record<string, unknown>>;
    Object.assign(invalid[0], {
      mode: 'claim',
      modeDefaults: { stakeBps: '0', stakeRequired: false },
    });
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow(/wrong task mode/i);
  });

  it('rejects duplicate token keys', () => {
    const invalid = structuredClone(templateCatalogue) as Array<{
      tokens: Array<{ key: string }>;
    }>;
    invalid[0].tokens[1].key = invalid[0].tokens[0].key;
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow(/token keys must be unique/i);
  });

  it('rejects readiness keys that collide with another authored prompt value', () => {
    const invalid = structuredClone(templateCatalogue) as Array<{
      readiness: Array<{ key: string }>;
      tokens: Array<{ key: string }>;
    }>;
    invalid[0].readiness[0].key = invalid[0].tokens[0].key;
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow(/readiness keys must be unique/i);
  });

  it('rejects a readiness URL in the composed title', () => {
    const invalid = structuredClone(templateCatalogue) as Array<{
      titleTemplate: string;
    }>;
    invalid[0].titleTemplate = 'Design from {{brandPack}}';
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow(/only short subject fields/i);
  });

  it('rejects malformed or undeclared placeholder syntax', () => {
    const invalid = structuredClone(templateCatalogue) as Array<{
      brief: Array<{ body: string }>;
    }>;
    invalid[0].brief[0].body = invalid[0].brief[0].body.replace('{{brand}}', '{{brand-name}}');
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow(/undeclared prompt value/i);
  });

  it('rejects zero-hour mode entry deadlines', () => {
    const invalid = structuredClone(templateCatalogue) as Array<Record<string, unknown>>;
    const pitch = invalid.find((template) => template.id === 'ai-integration');
    pitch!.modeDefaults = { pitchDeadline: '0' };
    expect(() => validateTaskTemplateCatalogue(invalid)).toThrow();
  });
});

describe('DEFAULT_TEMPLATE_ID', () => {
  it('represents the blank choice outside the catalogue', () => {
    expect(DEFAULT_TEMPLATE_ID).toBeNull();
    expect(findTemplate(DEFAULT_TEMPLATE_ID)).toBeUndefined();
  });
});
