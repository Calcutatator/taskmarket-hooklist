import { TASK_DESCRIPTION_MAX_LENGTH, type TaskModeType } from '@taskmarket/shared';
import {
  IconActivity,
  IconBug,
  IconChartArcs,
  IconDatabase,
  IconFileText,
  IconFileSearch,
  IconGauge,
  IconLayoutDashboard,
  IconListCheck,
  IconNotes,
  IconPalette,
  IconRobot,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconTransfer,
  type Icon,
} from '@tabler/icons-react';
import { z } from 'zod';

import templateCatalogue from './task-templates.json';
import { TASK_TITLE_MAX_LENGTH } from './task-title';

const TEMPLATE_IDS = [
  'logo',
  'infographic',
  'landing-copy',
  'bug-fix',
  'content-migration',
  'dataset-cleanup',
  'ai-integration',
  'ux-ui-redesign',
  'go-to-market',
  'prompt-eval',
  'api-latency',
  'data-extraction',
  'data-labeling',
  'cross-browser-qa',
  'data-entry',
] as const;

const TEMPLATE_MODE_BY_ID: Record<(typeof TEMPLATE_IDS)[number], TaskModeType> = {
  'ai-integration': 'pitch',
  'api-latency': 'benchmark',
  'bug-fix': 'claim',
  'content-migration': 'claim',
  'cross-browser-qa': 'auction',
  'data-entry': 'auction',
  'data-extraction': 'benchmark',
  'data-labeling': 'auction',
  'dataset-cleanup': 'claim',
  'go-to-market': 'pitch',
  infographic: 'bounty',
  'landing-copy': 'bounty',
  logo: 'bounty',
  'prompt-eval': 'benchmark',
  'ux-ui-redesign': 'pitch',
};

const BRIEF_HEADINGS = [
  'Outcome',
  'Public inputs',
  'Readiness gate',
  'Deliverables',
  'Acceptance',
  'Evidence',
  'Boundaries',
  'How selection works',
] as const;

const tokenSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    label: z.string().min(1),
    placeholder: z.string().min(1),
    defaultValue: z.string().min(1).optional(),
    required: z.boolean(),
  })
  .strict();

const readinessItemSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    label: z.string().min(1),
    help: z.string().min(1),
    input: z.enum(['shortText', 'longText', 'url']),
    placeholder: z.string().min(1),
    defaultValue: z.string().min(1).optional(),
    publicAccess: z.enum(['required', 'notApplicable']),
    required: z.boolean(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.publicAccess === 'required' && item.input !== 'url') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Public-access readiness items must use a URL input.',
        path: ['input'],
      });
    }
  });

const briefSectionSchemas = BRIEF_HEADINGS.map((heading) =>
  z.object({ heading: z.literal(heading), body: z.string().min(1) }).strict()
) as [
  z.ZodObject<{ heading: z.ZodLiteral<'Outcome'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'Public inputs'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'Readiness gate'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'Deliverables'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'Acceptance'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'Evidence'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'Boundaries'>; body: z.ZodString }>,
  z.ZodObject<{ heading: z.ZodLiteral<'How selection works'>; body: z.ZodString }>,
];

const baseTemplateSchema = z
  .object({
    id: z.enum(TEMPLATE_IDS),
    label: z.string().min(1),
    shortDescription: z.string().min(1),
    titleTemplate: z.string().min(1),
    icon: z.enum([
      'activity',
      'bug',
      'chart',
      'database',
      'file-text',
      'file-search',
      'gauge',
      'layout',
      'list-check',
      'notes',
      'palette',
      'robot',
      'rocket',
      'shield-check',
      'sparkles',
      'transfer',
    ]),
    motif: z.enum(['grid', 'rays', 'rings', 'signal', 'steps']),
    durationHours: z.number().int().min(24).max(720),
    tags: z
      .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
      .min(3)
      .max(5)
      .refine((tags) => new Set(tags).size === tags.length, 'Template tags must be unique.'),
    bestFor: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
    details: z.object({ includes: z.string().min(1), success: z.string().min(1) }).strict(),
    tokens: z.array(tokenSchema).min(2).max(3),
    readiness: z.array(readinessItemSchema).min(1).max(3),
    brief: z.tuple(briefSectionSchemas).readonly(),
  })
  .strict();

const catalogueSchema = z.array(
  z.discriminatedUnion('mode', [
    baseTemplateSchema.extend({ mode: z.literal('bounty') }),
    baseTemplateSchema.extend({
      mode: z.literal('claim'),
      modeDefaults: z
        .object({ stakeRequired: z.literal(false), stakeBps: z.literal('0') })
        .strict(),
    }),
    baseTemplateSchema.extend({
      mode: z.literal('pitch'),
      modeDefaults: z.object({ pitchDeadline: z.string().regex(/^[1-9]\d*$/) }).strict(),
    }),
    baseTemplateSchema.extend({
      mode: z.literal('benchmark'),
      modeDefaults: z
        .object({
          metricDescription: z.string().min(1),
          metricTarget: z.string().min(1),
        })
        .strict(),
    }),
    baseTemplateSchema.extend({
      mode: z.literal('auction'),
      modeDefaults: z
        .object({
          auctionType: z.enum(['english', 'reverse_english']),
          bidDeadline: z.string().regex(/^[1-9]\d*$/),
        })
        .strict(),
    }),
  ])
);

const iconByKey = {
  activity: IconActivity,
  bug: IconBug,
  chart: IconChartArcs,
  database: IconDatabase,
  'file-text': IconFileText,
  'file-search': IconFileSearch,
  gauge: IconGauge,
  layout: IconLayoutDashboard,
  'list-check': IconListCheck,
  notes: IconNotes,
  palette: IconPalette,
  robot: IconRobot,
  rocket: IconRocket,
  'shield-check': IconShieldCheck,
  sparkles: IconSparkles,
  transfer: IconTransfer,
} as const satisfies Record<string, Icon>;

export type TaskTemplateId = (typeof TEMPLATE_IDS)[number];
export type TemplateToken = z.infer<typeof tokenSchema>;
export type TemplateReadinessItem = z.infer<typeof readinessItemSchema>;
export type BriefSection = { heading: (typeof BRIEF_HEADINGS)[number]; body: string };
type ParsedTaskTemplate = z.infer<typeof catalogueSchema>[number];
type TaskTemplateFrom<T> = T extends unknown
  ? Omit<T, 'brief' | 'readiness' | 'tokens'> & {
      brief: BriefSection[];
      iconComponent: Icon;
      readiness: TemplateReadinessItem[];
      tokens: TemplateToken[];
    }
  : never;
export type TaskTemplate = TaskTemplateFrom<ParsedTaskTemplate>;
export type TaskTemplateSelection = TaskTemplateId | null;

export function validateTaskTemplateCatalogue(catalogue: unknown): TaskTemplate[] {
  const parsed = catalogueSchema.parse(catalogue);
  const ids = new Set(parsed.map((template) => template.id));
  if (parsed.length !== TEMPLATE_IDS.length || ids.size !== TEMPLATE_IDS.length) {
    throw new Error('Task template catalogue must contain each supported template exactly once.');
  }

  for (const template of parsed) {
    const tokenKeys = new Set(template.tokens.map((token) => token.key));
    const readinessKeys = new Set(template.readiness.map((item) => item.key));
    const authoredKeys = new Set([...tokenKeys, ...readinessKeys]);
    if (TEMPLATE_MODE_BY_ID[template.id] !== template.mode) {
      throw new Error(`Task template ${template.id} is assigned to the wrong task mode.`);
    }
    if (tokenKeys.size !== template.tokens.length) {
      throw new Error(`Task template ${template.id} token keys must be unique.`);
    }
    if (
      readinessKeys.size !== template.readiness.length ||
      [...readinessKeys].some((key) => tokenKeys.has(key))
    ) {
      throw new Error(`Task template ${template.id} readiness keys must be unique.`);
    }
    const placeholders = [
      ...Array.from(template.titleTemplate.matchAll(/\{\{([^{}]+)\}\}/g), (match) => match[1]),
      ...template.brief.flatMap((section) =>
        Array.from(section.body.matchAll(/\{\{([^{}]+)\}\}/g), (match) => match[1])
      ),
    ];
    const titlePlaceholders = Array.from(
      template.titleTemplate.matchAll(/\{\{([^{}]+)\}\}/g),
      (match) => match[1]
    );
    if (titlePlaceholders.some((key) => !tokenKeys.has(key))) {
      throw new Error(`Task template ${template.id} title may use only short subject fields.`);
    }
    if (placeholders.some((key) => !authoredKeys.has(key))) {
      throw new Error(`Task template ${template.id} uses an undeclared prompt value.`);
    }
    if (template.tokens.some((token) => !placeholders.includes(token.key))) {
      throw new Error(`Task template ${template.id} declares an unused brief token.`);
    }
    if (template.readiness.some((item) => !placeholders.includes(item.key))) {
      throw new Error(`Task template ${template.id} declares an unused readiness item.`);
    }
    const authoredLength = template.brief.map((section) => section.body).join('\n\n').length;
    if (authoredLength > TASK_DESCRIPTION_MAX_LENGTH) {
      throw new Error(`Task template ${template.id} brief exceeds the task description limit.`);
    }
    if (
      template.mode === 'pitch' &&
      Number(template.modeDefaults.pitchDeadline) >= template.durationHours
    ) {
      throw new Error(`Task template ${template.id} must leave time after the pitch deadline.`);
    }
    if (
      template.mode === 'auction' &&
      Number(template.modeDefaults.bidDeadline) >= template.durationHours
    ) {
      throw new Error(`Task template ${template.id} must leave time after the bid deadline.`);
    }
  }

  return parsed.map((template) => ({
    ...template,
    brief: [...template.brief],
    iconComponent: iconByKey[template.icon],
    readiness: [...template.readiness],
    tokens: [...template.tokens],
  }));
}

export const taskTemplates = validateTaskTemplateCatalogue(templateCatalogue);
export const DEFAULT_TEMPLATE_ID: null = null;

export function templatesForMode(mode: TaskModeType): TaskTemplate[] {
  return taskTemplates.filter((template) => template.mode === mode);
}

export function findTemplate(id: string | null | undefined): TaskTemplate | undefined {
  return id ? taskTemplates.find((template) => template.id === id) : undefined;
}

export function templateBelongsToMode(
  id: string | null | undefined,
  mode: TaskModeType
): id is TaskTemplateId {
  return findTemplate(id)?.mode === mode;
}

export type VisualPreset = { id: string; label: string; line: string };

export const VISUAL_PRESETS: readonly VisualPreset[] = [
  {
    id: 'data-dense',
    label: 'Data-dense',
    line: 'Visual direction: data-dense, with charts, stats, and labelled callouts doing the heavy lifting.',
  },
  {
    id: 'bold-minimal',
    label: 'Bold & minimal',
    line: 'Visual direction: bold and minimal, with a few big numbers, strong hierarchy, and generous whitespace.',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    line: 'Visual direction: editorial, with a magazine-style layout, refined type, and a clear narrative flow.',
  },
] as const;

export function findVisualPreset(id: string): VisualPreset | undefined {
  return VISUAL_PRESETS.find((preset) => preset.id === id);
}

export function composeBriefWithPreset(
  template: TaskTemplate,
  tokenValues: Record<string, string>,
  readinessValues: Record<string, string> = {},
  presetId?: string
): string {
  const base = composeBrief(template, tokenValues, readinessValues);
  const preset = presetId ? findVisualPreset(presetId) : undefined;
  if (!preset) {
    return base;
  }
  return `${base}\n\n${preset.line}`;
}

export function isTemplateReadinessValueValid(
  item: TemplateReadinessItem,
  value?: string,
  publicAccessConfirmed = false
): boolean {
  const resolved = value?.trim() || item.defaultValue?.trim() || '';
  if (!resolved) return !item.required;
  if (item.input !== 'url') return true;

  return isTemplateReadinessUrlValid(resolved) && publicAccessConfirmed;
}

export function isTemplateReadinessUrlValid(value: string): boolean {
  const resolved = value.trim();

  try {
    const url = new URL(resolved);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function promptValueResolver(
  template: TaskTemplate,
  tokenValues: Record<string, string>,
  readinessValues: Record<string, string>
) {
  return (key: string): string => {
    const userValue = tokenValues[key]?.trim();
    if (userValue) return userValue;
    const token = template.tokens.find((entry) => entry.key === key);
    if (token) return token.defaultValue ?? `[Add: ${token.label}]`;
    const readinessValue = readinessValues[key]?.trim();
    if (readinessValue) return readinessValue;
    const readinessItem = template.readiness.find((entry) => entry.key === key);
    return readinessItem?.defaultValue ?? (readinessItem ? `[Add: ${readinessItem.label}]` : '');
  };
}

export function composedTemplateTitle(
  template: TaskTemplate,
  tokenValues: Record<string, string>
): string {
  const resolve = promptValueResolver(template, tokenValues, {});
  return template.titleTemplate
    .replace(/\{\{(\w+)\}\}/g, (_match, key: string) => resolve(key))
    .replace(/\s+/g, ' ')
    .trim();
}

export function isComposedTemplateTitleValid(
  template: TaskTemplate,
  tokenValues: Record<string, string>
): boolean {
  const title = composedTemplateTitle(template, tokenValues);
  return title.length > 0 && title.length <= TASK_TITLE_MAX_LENGTH;
}

export function composeBrief(
  template: TaskTemplate,
  tokenValues: Record<string, string>,
  readinessValues: Record<string, string> = {}
): string {
  const resolve = promptValueResolver(template, tokenValues, readinessValues);

  const replaceTokens = (value: string) =>
    value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => resolve(key));
  const title = composedTemplateTitle(template, tokenValues);

  return [
    title,
    ...template.brief.map((section) => `${section.heading}\n${replaceTokens(section.body)}`),
  ]
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
