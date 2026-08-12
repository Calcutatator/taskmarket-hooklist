'use client';

import type { TaskModeType } from '@taskmarket/shared';
import { IconCheck, IconChevronDown, IconCircleDashed, IconClockHour4 } from '@tabler/icons-react';
import { useState, type CSSProperties } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { handleRadioGroupKeyDown } from '@/lib/market/create-task-form';
import { taskModeOptions } from '@/lib/market/task-mode-config';
import {
  findTemplate,
  templatesForMode,
  type TaskTemplate,
  type TaskTemplateSelection,
} from '@/lib/market/task-templates';
import { cn } from '@/lib/utils';

export type StepTemplateProps = {
  mode: TaskModeType;
  onContinue: () => void;
  onModeChange: (mode: TaskModeType) => void;
  onTemplateChange: (templateId: TaskTemplateSelection) => void;
  templateId: TaskTemplateSelection;
};

type CardMotif = TaskTemplate['motif'] | 'blank';

const modeDetails: Record<
  TaskModeType,
  { cue: string; explanation: string; facts: [string, string, string] }
> = {
  auction: {
    cue: 'Lowest price',
    explanation: 'Workers bid on one brief; the selected price sets the payout.',
    facts: ['Workers bid on price', 'Mechanism selects one', 'Winning delivery is paid'],
  },
  benchmark: {
    cue: 'Best metric',
    explanation: 'Workers submit comparable proof against one measure; you verify the result.',
    facts: ['Many may compete', 'Requester verifies', 'Accepted proof is paid'],
  },
  bounty: {
    cue: 'Best result',
    explanation: 'Workers deliver in parallel; you pay the result that best meets the brief.',
    facts: ['Many work at once', 'Requester chooses', 'Accepted result is paid'],
  },
  claim: {
    cue: 'First claim',
    explanation:
      'One worker reserves deterministic work before starting, avoiding duplicate effort.',
    facts: ['One worker reserves', 'First eligible claim wins', 'Accepted delivery is paid'],
  },
  pitch: {
    cue: 'Best plan',
    explanation: 'Workers propose an approach first; you select one plan for full delivery.',
    facts: ['Many propose', 'Requester selects a plan', 'Selected worker delivers'],
  },
};

const motifStyles: Record<CardMotif, CSSProperties> = {
  blank: {
    backgroundImage:
      'radial-gradient(circle, color-mix(in oklab, var(--muted-foreground) 24%, transparent) 1px, transparent 1.5px)',
    backgroundSize: '12px 12px',
  },
  grid: {
    backgroundImage:
      'linear-gradient(color-mix(in oklab, var(--primary) 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--primary) 14%, transparent) 1px, transparent 1px)',
    backgroundSize: '18px 18px',
  },
  rays: {
    backgroundImage:
      'repeating-linear-gradient(118deg, transparent 0 14px, color-mix(in oklab, var(--primary) 14%, transparent) 15px 16px, transparent 17px 30px)',
  },
  rings: {
    backgroundImage:
      'radial-gradient(circle at 82% 50%, transparent 0 20px, color-mix(in oklab, var(--primary) 18%, transparent) 21px 22px, transparent 23px 38px, color-mix(in oklab, var(--primary) 12%, transparent) 39px 40px, transparent 41px)',
  },
  signal: {
    backgroundImage:
      'repeating-radial-gradient(ellipse at 86% 100%, transparent 0 12px, color-mix(in oklab, var(--primary) 14%, transparent) 13px 14px, transparent 15px 24px)',
  },
  steps: {
    backgroundImage:
      'linear-gradient(135deg, transparent 0 48%, color-mix(in oklab, var(--primary) 15%, transparent) 49% 51%, transparent 52%), linear-gradient(45deg, transparent 0 48%, color-mix(in oklab, var(--primary) 9%, transparent) 49% 51%, transparent 52%)',
    backgroundSize: '28px 28px',
  },
};

function TemplateCard({
  expanded,
  onExpandedChange,
  onSelect,
  selected,
  template,
}: {
  expanded: boolean;
  onExpandedChange: () => void;
  onSelect: () => void;
  selected: boolean;
  template: TaskTemplate;
}) {
  const Icon = template.iconComponent;
  const detailId = `template-${template.id}-details`;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/68 bg-card/52 shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-border/82 hover:shadow-[var(--shadow-control)] motion-reduce:transform-none motion-reduce:transition-none',
        selected && 'border-primary/60 bg-primary/8 shadow-[var(--shadow-control)]'
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary transition-opacity"
        style={{ opacity: selected ? 1 : 0 }}
      />
      <button
        aria-checked={selected}
        aria-describedby={expanded ? detailId : undefined}
        className="relative flex min-h-72 w-full flex-col text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35"
        onClick={onSelect}
        role="radio"
        tabIndex={selected ? 0 : -1}
        type="button"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-75"
          style={motifStyles[template.motif]}
        />
        <span className="relative flex items-start justify-between gap-3 p-5 pb-0">
          <span className="flex size-14 items-center justify-center rounded-2xl border border-primary/28 bg-primary/10 text-primary shadow-[var(--shadow-soft)]">
            <Icon className="size-7" aria-hidden="true" />
          </span>
          {selected ? (
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <IconCheck aria-hidden="true" className="size-4" />
            </span>
          ) : null}
        </span>
        <span className="relative grid flex-1 content-start gap-2 p-5 pt-4">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-semibold tracking-tight text-foreground">
              {template.label}
            </span>
            {template.mode === 'auction' ? (
              <Badge variant="secondary">
                {template.modeDefaults.auctionType === 'reverse_english'
                  ? 'Sealed bids'
                  : 'Open bids'}
              </Badge>
            ) : null}
          </span>
          <span className="text-sm leading-6 text-muted-foreground">
            {template.shortDescription}
          </span>
          <span className="mt-2 grid gap-1.5">
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
              Best for
            </span>
            {template.bestFor.map((item) => (
              <span className="flex items-start gap-2 text-xs leading-5 text-foreground" key={item}>
                <IconCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {item}
              </span>
            ))}
          </span>
        </span>
        <span className="relative flex items-center gap-2 px-5 pb-4 font-mono text-xs text-muted-foreground">
          <IconClockHour4 aria-hidden="true" className="size-4" />
          Suggested: {template.durationHours}h
        </span>
      </button>
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        className="relative flex w-full items-center justify-between border-t border-border/60 px-5 py-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/24 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35"
        onClick={onExpandedChange}
        type="button"
      >
        Details
        <IconChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 transition-transform motion-reduce:transition-none',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded ? (
        <div
          className="grid gap-3 border-t border-border/60 bg-background/42 p-5 text-xs leading-5"
          id={detailId}
        >
          <p>
            <span className="font-semibold text-foreground">Includes: </span>
            <span className="text-muted-foreground">{template.details.includes}</span>
          </p>
          <p>
            <span className="font-semibold text-foreground">Success: </span>
            <span className="text-muted-foreground">{template.details.success}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function StepTemplate({
  mode,
  onContinue,
  onModeChange,
  onTemplateChange,
  templateId,
}: StepTemplateProps) {
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const currentMode = taskModeOptions.find((option) => option.value === mode) ?? taskModeOptions[0];
  const detail = modeDetails[mode];
  const templates = templatesForMode(mode);
  const selectedTemplate = findTemplate(templateId);
  const templateChoiceValues = [...templates.map((template) => template.id), 'blank'];

  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-label="Work type">
        <div
          aria-describedby="work-type-explanation"
          aria-label="Task mode"
          className="grid grid-cols-2 gap-2 rounded-2xl border border-border/68 bg-surface/44 p-2 sm:grid-cols-5"
          onKeyDown={(event) =>
            handleRadioGroupKeyDown(
              event,
              taskModeOptions.map((option) => option.value),
              mode,
              (value) => onModeChange(value as TaskModeType)
            )
          }
          role="radiogroup"
        >
          {taskModeOptions.map((option) => {
            const Icon = option.icon;
            const selected = option.value === mode;
            return (
              <button
                aria-checked={selected}
                className={cn(
                  'grid min-h-24 content-center justify-items-center gap-2 rounded-xl border border-transparent px-3 py-3 text-center transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
                  selected
                    ? 'border-primary/48 bg-primary/10 text-foreground shadow-[var(--shadow-soft)]'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                )}
                key={option.value}
                onClick={() => onModeChange(option.value)}
                role="radio"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <Icon aria-hidden="true" className={cn('size-6', selected && 'text-primary')} />
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em]">
                  {modeDetails[option.value].cue}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="grid gap-4 rounded-2xl border border-primary/28 bg-primary/6 p-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)] sm:items-center"
          id="work-type-explanation"
        >
          <p className="max-w-2xl text-sm leading-6 text-foreground">{detail.explanation}</p>
          <div className="grid gap-2 sm:border-l sm:border-border/60 sm:pl-5">
            {detail.facts.map((fact) => (
              <span className="flex items-center gap-2 text-xs text-foreground" key={fact}>
                <IconCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
                {fact}
              </span>
            ))}
          </div>
        </div>
        <p aria-live="polite" className="sr-only">
          {currentMode.label} selected. {selectedTemplate?.label ?? 'Start blank'} selected.
        </p>
      </section>

      <section className="grid gap-3" aria-labelledby="template-heading">
        <div className="grid gap-1">
          <h3 className="font-display text-lg font-semibold tracking-tight" id="template-heading">
            Choose a starting point
          </h3>
          <p className="text-sm text-muted-foreground">
            Templates prefill the brief and settings, never the reward.
          </p>
        </div>
        <div
          aria-label="Task template"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          onKeyDown={(event) =>
            handleRadioGroupKeyDown(event, templateChoiceValues, templateId ?? 'blank', (value) =>
              onTemplateChange(value === 'blank' ? null : (findTemplate(value)?.id ?? null))
            )
          }
          role="radiogroup"
        >
          {templates.map((template) => (
            <TemplateCard
              expanded={expandedTemplateId === template.id}
              key={template.id}
              onExpandedChange={() =>
                setExpandedTemplateId((current) => (current === template.id ? null : template.id))
              }
              onSelect={() => onTemplateChange(template.id)}
              selected={template.id === templateId}
              template={template}
            />
          ))}

          <div
            className={cn(
              'relative overflow-hidden rounded-2xl border border-dashed border-border/72 bg-card/36 shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-border/90 motion-reduce:transform-none motion-reduce:transition-none',
              templateId === null &&
                'border-solid border-primary/60 bg-primary/8 shadow-[var(--shadow-control)]'
            )}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-65"
              style={motifStyles.blank}
            />
            <button
              aria-checked={templateId === null}
              className="relative flex min-h-72 w-full flex-col p-5 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35"
              onClick={() => onTemplateChange(null)}
              role="radio"
              tabIndex={templateId === null ? 0 : -1}
              type="button"
            >
              <span className="flex size-14 items-center justify-center rounded-2xl border border-border/68 bg-background/70 text-muted-foreground shadow-[var(--shadow-soft)]">
                <IconCircleDashed aria-hidden="true" className="size-7" />
              </span>
              <span className="mt-4 font-display text-lg font-semibold tracking-tight text-foreground">
                Start blank
              </span>
              <span className="mt-2 text-sm leading-6 text-muted-foreground">
                Write the brief and settings yourself.
              </span>
            </button>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={onContinue} type="button">
          Continue to brief
        </Button>
      </div>
    </div>
  );
}
