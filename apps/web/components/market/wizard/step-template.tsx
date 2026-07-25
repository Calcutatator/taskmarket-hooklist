'use client';

import { IconClockHour4, IconCoin } from '@tabler/icons-react';

import { MarketLiquidityStrip } from '@/components/market/market-liquidity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MarketStats } from '@/lib/api/server';
import { handleRadioGroupKeyDown } from '@/lib/market/create-task-form';
import { findTemplate, type TaskTemplate, taskTemplates } from '@/lib/market/task-templates';
import { cn } from '@/lib/utils';

type StepTemplateProps = {
  templateId: TaskTemplate['id'];
  applyTemplate: (template: TaskTemplate) => void;
  marketStats: MarketStats | null;
  onCustomize: () => void;
  onExpressPublish: () => void;
};

function templateMeta(template: TaskTemplate) {
  if (template.id === 'custom') {
    return 'No template applied';
  }
  return `~$${template.suggestedRewardUsdc} reward . ${template.suggestedDurationHours}h`;
}

// Per-template accent so the gallery reads as a designed set, not a plain list.
// Full static class strings (Tailwind cannot resolve interpolated class names).
const TEMPLATE_ACCENT: Record<
  TaskTemplate['id'],
  { glow: string; chip: string; meta: string; selected: string }
> = {
  logo: {
    glow: 'from-primary/12',
    chip: 'border-primary/30 bg-primary/12 text-primary',
    meta: 'text-primary',
    selected: 'border-primary/60 bg-primary/8',
  },
  infographic: {
    glow: 'from-accent/12',
    chip: 'border-accent/30 bg-accent/12 text-accent',
    meta: 'text-accent',
    selected: 'border-accent/60 bg-accent/8',
  },
  'landing-copy': {
    glow: 'from-info/12',
    chip: 'border-info/30 bg-info/12 text-info',
    meta: 'text-info',
    selected: 'border-info/60 bg-info/8',
  },
  custom: {
    glow: 'from-muted/25',
    chip: 'border-border/68 bg-background/50 text-muted-foreground',
    meta: 'text-muted-foreground',
    selected: 'border-primary/56 bg-primary/8',
  },
};

export function StepTemplate({
  applyTemplate,
  marketStats,
  onCustomize,
  onExpressPublish,
  templateId,
}: StepTemplateProps) {
  const selectedTemplate = findTemplate(templateId) ?? taskTemplates[0];
  const isCustom = selectedTemplate.id === 'custom';

  return (
    <div className="grid gap-5">
      <MarketLiquidityStrip stats={marketStats} />

      <div
        aria-label="Task template"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        onKeyDown={(event) =>
          handleRadioGroupKeyDown(
            event,
            taskTemplates.map((template) => template.id),
            templateId,
            (value) => {
              const next = findTemplate(value);
              if (next) {
                applyTemplate(next);
              }
            }
          )
        }
        role="radiogroup"
      >
        {taskTemplates.map((template) => {
          const Icon = template.icon;
          const selected = template.id === templateId;
          const custom = template.id === 'custom';
          const accent = TEMPLATE_ACCENT[template.id];

          return (
            <button
              aria-checked={selected}
              className={cn(
                'group relative flex min-h-52 flex-col overflow-hidden rounded-2xl border border-border/68 bg-card/44 text-left shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-border/80 hover:shadow-[var(--shadow-control)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
                custom && 'border-dashed',
                selected && cn('shadow-[var(--shadow-control)]', accent.selected)
              )}
              key={template.id}
              onClick={() => applyTemplate(template)}
              role="radio"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b to-transparent opacity-80 transition-opacity duration-300 group-hover:opacity-100',
                  accent.glow
                )}
              />
              <span className="relative flex items-start justify-between gap-3 p-4 pb-0">
                <span
                  className={cn(
                    'flex size-12 items-center justify-center rounded-2xl border shadow-[var(--shadow-soft)] transition-transform duration-300 ease-[var(--ease-premium)] group-hover:scale-105',
                    accent.chip
                  )}
                >
                  <Icon className="size-6" />
                </span>
                <Badge variant="terminal">{template.mode}</Badge>
              </span>
              <span className="flex flex-1 flex-col gap-1.5 p-4 pt-3">
                <span className="font-sans text-base font-semibold tracking-tight text-foreground">
                  {template.label}
                </span>
                <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                  {template.shortDescription}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 p-4 pt-0">
                {custom ? (
                  <span className="inline-flex items-center rounded-full border border-dashed border-border/68 bg-background/40 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted-foreground">
                    No template applied
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/55 px-2.5 py-1 font-mono text-xs text-foreground shadow-[var(--shadow-soft)]">
                      <IconCoin className={cn('size-3.5', accent.meta)} />$
                      {template.suggestedRewardUsdc}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/55 px-2.5 py-1 font-mono text-xs text-foreground shadow-[var(--shadow-soft)]">
                      <IconClockHour4 className="size-3.5 text-muted-foreground" />
                      {template.suggestedDurationHours}h
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="safe-area-sticky-bottom sticky z-10 grid gap-4 rounded-xl border border-border/68 bg-surface/58 p-4 shadow-[var(--shadow-control)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="grid gap-1">
          <p className="font-sans text-sm font-semibold tracking-tight text-foreground">
            {selectedTemplate.label}
          </p>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            {templateMeta(selectedTemplate)}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {isCustom ? (
            <Button onClick={onCustomize} type="button">
              Write the brief
            </Button>
          ) : (
            <>
              <Button onClick={onCustomize} type="button">
                Customize brief
              </Button>
              <Button onClick={onExpressPublish} type="button" variant="outline">
                Use this and publish
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
