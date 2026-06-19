import type { TaskModeType } from '@taskmarket/shared';
import { IconChartArcs, IconNotes, IconPalette, IconPencil } from '@tabler/icons-react';

// A single light personalization input rendered under the brief. Its key is
// referenced as {{key}} inside brief section bodies.
export type TemplateToken = {
  key: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
};

// One ordered section of an authored brief. Body may contain {{token}}
// placeholders and newline-delimited bullets.
export type BriefSection = {
  heading: string;
  body: string;
};

export type TaskTemplate = {
  id: 'custom' | 'logo' | 'infographic' | 'landing-copy';
  label: string;
  shortDescription: string;
  icon: typeof IconPalette;
  mode: TaskModeType;
  suggestedRewardUsdc: string;
  suggestedDurationHours: number;
  suggestedTags: string[];
  tokens: TemplateToken[];
  brief: BriefSection[];
  briefSource: 'static';
};

// Maximum brief length the server contract accepts for a task description.
const BRIEF_MAX_LENGTH = 2_000;

export const taskTemplates = [
  {
    id: 'logo',
    label: 'Logo',
    shortDescription: 'A polished primary logo with usable source files and basic usage guidance.',
    icon: IconPalette,
    mode: 'bounty',
    suggestedRewardUsdc: '2',
    suggestedDurationHours: 96,
    suggestedTags: ['design', 'branding', 'logo'],
    tokens: [
      {
        key: 'brand',
        label: 'Brand or product name',
        placeholder: 'Acme Labs',
        defaultValue: 'our brand',
        required: true,
      },
      {
        key: 'style',
        label: 'Style direction',
        placeholder: 'modern, minimal, geometric',
        defaultValue: 'modern and minimal',
      },
    ],
    brief: [
      {
        heading: 'Goal',
        body: 'Design a primary logo for {{brand}}. The mark should feel {{style}}, read clearly at small sizes, and work in both light and dark contexts.',
      },
      {
        heading: 'Inputs provided',
        body: 'Brand name and any existing assets on request.\nPreferred style direction: {{style}}.\nReference logos we like or want to avoid, shared on claim.',
      },
      {
        heading: 'Deliverables',
        body: 'Primary logo lockup plus a standalone icon mark.\nVector source files (SVG and the original editable format).\nPNG exports at 1x, 2x, and 3x on transparent backgrounds.\nA short one-page usage note covering clear space and minimum size.',
      },
      {
        heading: 'Acceptance criteria',
        body: 'Legible from a 16px favicon up to a large banner.\nWorks in full color, single color, and reversed (white on dark).\nNo stock clip art, no AI watermarks, original work only.\nDelivered in the formats listed above.',
      },
      {
        heading: 'Review',
        body: 'One round of revisions is included after the first submission. Final files are accepted once the lockup and icon pass the acceptance criteria.',
      },
    ],
    briefSource: 'static',
  },
  {
    id: 'infographic',
    label: 'Infographic',
    shortDescription:
      'A single shareable infographic that turns your data into a clear visual story.',
    icon: IconChartArcs,
    mode: 'bounty',
    suggestedRewardUsdc: '2',
    suggestedDurationHours: 72,
    suggestedTags: ['design', 'infographic', 'data-viz'],
    tokens: [
      {
        key: 'topic',
        label: 'Infographic topic',
        placeholder: 'state of remote work in 2026',
        defaultValue: 'the topic provided',
        required: true,
      },
      {
        key: 'audience',
        label: 'Target audience',
        placeholder: 'startup founders',
        defaultValue: 'a general audience',
      },
    ],
    brief: [
      {
        heading: 'Goal',
        body: 'Create a single-page infographic about {{topic}} aimed at {{audience}}. It should communicate the key points at a glance and be easy to share on social and in a blog post.',
      },
      {
        heading: 'Inputs provided',
        body: 'The underlying data points and source links, shared on claim.\nKey message we want the reader to take away.\nAny brand colors or fonts to follow, if available.',
      },
      {
        heading: 'Deliverables',
        body: 'One vertical infographic optimized for web and social sharing.\nEditable source file plus a high-resolution PNG export.\nA web-optimized PNG or JPG under 1 MB.',
      },
      {
        heading: 'Acceptance criteria',
        body: 'All figures match the provided data exactly, no invented numbers.\nClear visual hierarchy with a readable type scale.\nAccessible color contrast for text and key elements.\nNo emojis, no stock clip art, original layout work.',
      },
      {
        heading: 'Review',
        body: 'One round of revisions is included to correct data, copy, or layout issues. Final files are accepted once every figure is verified against the source.',
      },
    ],
    briefSource: 'static',
  },
  {
    id: 'landing-copy',
    label: 'Landing-page copy',
    shortDescription: 'Conversion-focused copy for a single landing page, section by section.',
    icon: IconNotes,
    mode: 'bounty',
    suggestedRewardUsdc: '2',
    suggestedDurationHours: 120,
    suggestedTags: ['copywriting', 'marketing', 'landing-page'],
    tokens: [
      {
        key: 'product',
        label: 'Product or service',
        placeholder: 'an AI scheduling assistant',
        defaultValue: 'the product',
        required: true,
      },
      {
        key: 'audience',
        label: 'Target audience',
        placeholder: 'busy operations teams',
        defaultValue: 'the target audience',
      },
      {
        key: 'tone',
        label: 'Tone',
        placeholder: 'confident and plain-spoken',
        defaultValue: 'clear and confident',
      },
    ],
    brief: [
      {
        heading: 'Goal',
        body: 'Write conversion-focused landing-page copy for {{product}}, speaking to {{audience}} in a {{tone}} tone. The page should explain the value quickly and drive sign-ups.',
      },
      {
        heading: 'Inputs provided',
        body: 'Product overview, top three benefits, and primary call to action, shared on claim.\nAny existing copy, positioning, or competitor pages for reference.\nThe single conversion goal for the page.',
      },
      {
        heading: 'Deliverables',
        body: 'A hero headline with a supporting subheadline.\nThree to five benefit sections with short headers and body copy.\nOne social-proof or trust section outline.\nA closing call-to-action block with button copy.\nTwo headline variants for the hero to support testing.',
      },
      {
        heading: 'Acceptance criteria',
        body: 'Copy is original and specific to {{product}}, not generic filler.\nEvery section maps to a clear reader benefit.\nNo unverifiable claims or invented statistics.\nDelivered as a structured document, section by section.',
      },
      {
        heading: 'Review',
        body: 'One round of revisions is included for tone, clarity, and structure. Copy is accepted once each section is complete and the call to action is clear.',
      },
    ],
    briefSource: 'static',
  },
  {
    id: 'custom',
    label: 'Custom',
    shortDescription:
      'Start from scratch and write your own brief with full control over every field.',
    icon: IconPencil,
    mode: 'bounty',
    suggestedRewardUsdc: '',
    suggestedDurationHours: 72,
    suggestedTags: [],
    tokens: [],
    brief: [],
    briefSource: 'static',
  },
] as const satisfies TaskTemplate[];

export const DEFAULT_TEMPLATE_ID: TaskTemplate['id'] = 'custom';

export function findTemplate(id: string): TaskTemplate | undefined {
  return taskTemplates.find((template) => template.id === id);
}

// Interpolate {{token}} placeholders (user value -> token defaultValue -> empty),
// render each section as "heading\nbody", drop empties, normalize blank gaps,
// trim, and clamp to the server brief limit. Pure, unit-tested.
export function composeBrief(template: TaskTemplate, tokenValues: Record<string, string>): string {
  const resolve = (key: string): string => {
    const userValue = tokenValues[key];
    if (userValue !== undefined && userValue.trim()) {
      return userValue.trim();
    }
    const token = template.tokens.find((entry) => entry.key === key);
    return token?.defaultValue ?? '';
  };

  const sections = template.brief
    .map((section) => {
      const resolvedBody = section.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
        resolve(key)
      );
      return { heading: section.heading, body: resolvedBody };
    })
    .map((section) =>
      [section.heading, section.body]
        .filter((part) => part.trim())
        .join('\n')
        .trim()
    )
    .filter((section) => section.length > 0);

  const composed = sections
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return composed.slice(0, BRIEF_MAX_LENGTH);
}
