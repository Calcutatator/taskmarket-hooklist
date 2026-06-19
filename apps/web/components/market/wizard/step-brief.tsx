'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { IconSparkles } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  countTags,
  type CreateTaskFieldErrors,
  handleRadioGroupKeyDown,
} from '@/lib/market/create-task-form';
import {
  composeBrief,
  findTemplate,
  type TaskTemplate,
  taskTemplates,
} from '@/lib/market/task-templates';
import { auctionTypeOptions, taskModeOptions } from '@/lib/market/task-mode-config';
import { cn } from '@/lib/utils';

import type { WizardFormValues } from '../create-task-wizard';

// Flag for the forward-compatible AI brief seam. The button is built but not
// rendered until real generation lands; flipping this to true wires it up.
const AI_BRIEF_ENABLED = false;

type StepBriefProps = {
  form: UseFormReturn<WizardFormValues>;
  templateId: TaskTemplate['id'];
  fieldErrors: CreateTaskFieldErrors;
  onChangeTemplate: () => void;
};

export function StepBrief({ fieldErrors, form, onChangeTemplate, templateId }: StepBriefProps) {
  const { control, register, setValue, watch } = form;
  const selectedTemplate = findTemplate(templateId) ?? taskTemplates[0];
  const isCustom = selectedTemplate.id === 'custom';

  const mode = watch('mode');
  const auctionType = watch('auctionType');
  const tagsValue = watch('tags');
  const tagCount = countTags(tagsValue ?? '');

  const [advancedOpen, setAdvancedOpen] = useState(mode === 'auction');
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});

  const advancedAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (mode === 'auction' && !advancedAutoOpenedRef.current) {
      setAdvancedOpen(true);
      advancedAutoOpenedRef.current = true;
    }
    if (mode !== 'auction') {
      advancedAutoOpenedRef.current = false;
    }
  }, [mode]);

  // Reset personalize tokens whenever the active template changes.
  useEffect(() => {
    setTokenValues({});
  }, [templateId]);

  const contextStripClassName = useMemo(
    () =>
      cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4',
        isCustom ? 'border-border/68 bg-surface/42' : 'border-primary/28 bg-primary/8'
      ),
    [isCustom]
  );

  function handleTokenChange(key: string, value: string) {
    const nextTokens = { ...tokenValues, [key]: value };
    setTokenValues(nextTokens);
    setValue('description', composeBrief(selectedTemplate, nextTokens), {
      shouldDirty: true,
    });
  }

  return (
    <div className="grid gap-6">
      <div className={contextStripClassName}>
        <p className="text-sm leading-5 text-foreground">
          {isCustom ? (
            'Custom brief. Write every field yourself.'
          ) : (
            <>
              Based on the <span className="font-semibold">{selectedTemplate.label}</span> template.
            </>
          )}
        </p>
        <Button onClick={onChangeTemplate} size="sm" type="button" variant="outline">
          Change template
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b border-border/75">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Brief</CardTitle>
              <CardDescription className="mt-2">
                Workers use this text to judge fit and completion.
              </CardDescription>
            </div>
            <Badge variant="terminal">Required</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 pt-6">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="description">
                Description
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              {AI_BRIEF_ENABLED ? (
                <Button size="sm" type="button" variant="outline">
                  <IconSparkles className="size-4" />
                  Generate with AI
                </Button>
              ) : null}
            </div>
            <Textarea
              aria-describedby={fieldErrors.description ? 'description-error' : undefined}
              aria-invalid={fieldErrors.description ? true : undefined}
              aria-required="true"
              className="min-h-48 resize-y text-base leading-6 md:text-sm"
              id="description"
              maxLength={2000}
              placeholder="Define the goal, input materials, acceptance criteria, review process, and delivery format."
              {...register('description')}
            />
            {fieldErrors.description ? (
              <p className="text-xs leading-5 text-destructive" id="description-error">
                {fieldErrors.description}
              </p>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                Include inputs, constraints, acceptance criteria, and delivery format.
              </p>
            )}
          </div>

          {selectedTemplate.tokens.length > 0 ? (
            <div className="grid gap-3 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
              <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                Personalize
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {selectedTemplate.tokens.map((token) => (
                  <div className="grid gap-2" key={token.key}>
                    <Label htmlFor={`token-${token.key}`}>{token.label}</Label>
                    <Input
                      id={`token-${token.key}`}
                      onChange={(event) => handleTokenChange(token.key, event.target.value)}
                      placeholder={token.placeholder}
                      value={tokenValues[token.key] ?? ''}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="reward">
                Reward
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center font-mono text-sm leading-none text-muted-foreground">
                  $
                </span>
                <Input
                  aria-describedby={fieldErrors.reward ? 'reward-error' : undefined}
                  aria-invalid={fieldErrors.reward ? true : undefined}
                  aria-required="true"
                  className="pl-11 font-mono"
                  id="reward"
                  min="0.01"
                  placeholder="25.00"
                  step="0.01"
                  type="number"
                  {...register('reward')}
                />
              </div>
              {fieldErrors.reward ? (
                <p className="text-xs leading-5 text-destructive" id="reward-error">
                  {fieldErrors.reward}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="duration">
                Duration hours
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Input
                aria-describedby={fieldErrors.duration ? 'duration-error' : undefined}
                aria-invalid={fieldErrors.duration ? true : undefined}
                aria-required="true"
                className="font-mono"
                id="duration"
                min="1"
                type="number"
                {...register('duration')}
              />
              {fieldErrors.duration ? (
                <p className="text-xs leading-5 text-destructive" id="duration-error">
                  {fieldErrors.duration}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="tags">Tags</Label>
              <Input
                aria-describedby={fieldErrors.tags ? 'tags-error' : 'tags-hint'}
                aria-invalid={fieldErrors.tags ? true : undefined}
                className="font-mono"
                id="tags"
                placeholder="research, code, audit"
                {...register('tags')}
              />
              {fieldErrors.tags ? (
                <p className="text-xs leading-5 text-destructive" id="tags-error">
                  {fieldErrors.tags}
                </p>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground" id="tags-hint">
                  {tagCount}/10 tags
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/75">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Mode &amp; advanced settings</CardTitle>
              <CardDescription className="mt-2">
                Choose how a worker is selected and paid, plus optional hook and evaluator settings.
              </CardDescription>
            </div>
            <Button
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
              size="sm"
              type="button"
              variant="outline"
            >
              {advancedOpen ? 'Hide' : 'Show'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={cn('grid gap-5 pt-6', !advancedOpen && 'hidden')}>
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <div
                aria-label="Task mode"
                className="grid gap-3 sm:grid-cols-2"
                onKeyDown={(event) =>
                  handleRadioGroupKeyDown(
                    event,
                    taskModeOptions.map((option) => option.value),
                    field.value,
                    field.onChange
                  )
                }
                role="radiogroup"
              >
                {taskModeOptions.map((taskMode) => {
                  const Icon = taskMode.icon;
                  const selected = taskMode.value === field.value;

                  return (
                    <button
                      aria-checked={selected}
                      className={cn(
                        'grid min-h-32 gap-3 rounded-xl border border-border/68 bg-background/46 p-4 text-left shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-primary/48 hover:bg-surface-2/52 active:scale-[0.99]',
                        selected && 'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
                      )}
                      key={taskMode.value}
                      onClick={() => field.onChange(taskMode.value)}
                      role="radio"
                      tabIndex={selected ? 0 : -1}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span
                          className={cn(
                            'flex size-9 items-center justify-center rounded-full border border-border/68 text-muted-foreground transition-colors',
                            selected && 'border-primary/70 bg-primary text-primary-foreground'
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
                          {selected ? 'Selected' : 'Mode'}
                        </span>
                      </span>
                      <span>
                        <span className="block font-sans text-sm font-semibold tracking-tight">
                          {taskMode.label}
                        </span>
                        <span className="mt-2 block text-sm leading-5 text-muted-foreground">
                          {taskMode.createDescription}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          />

          <div
            className={cn(
              'grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)] sm:grid-cols-2',
              mode !== 'claim' && 'hidden'
            )}
          >
            <Controller
              control={control}
              name="stakeRequired"
              render={({ field }) => (
                <label className="flex min-h-20 items-center gap-3 rounded-xl border border-border/68 bg-background/52 p-4 text-sm font-semibold tracking-tight">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  Require stake
                </label>
              )}
            />
            <div className="grid gap-2">
              <Label htmlFor="stakeBps">Stake percent</Label>
              <Input
                className="font-mono"
                id="stakeBps"
                max="100"
                min="0"
                step="0.01"
                type="number"
                {...register('stakeBps')}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Enter the percent of the reward a claimant must stake.
              </p>
            </div>
          </div>

          <div
            className={cn(
              'grid gap-2 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]',
              mode !== 'pitch' && 'hidden'
            )}
          >
            <Label htmlFor="pitchDeadline">Pitch deadline hours</Label>
            <Input
              className="font-mono"
              id="pitchDeadline"
              min="1"
              placeholder="24"
              type="number"
              {...register('pitchDeadline')}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Requesters enter hours. The task API receives seconds.
            </p>
          </div>

          <div
            className={cn(
              'grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)] sm:grid-cols-2',
              mode !== 'benchmark' && 'hidden'
            )}
          >
            <div className="grid gap-2">
              <Label htmlFor="metricDescription">Metric</Label>
              <Input
                id="metricDescription"
                placeholder="Test suite pass rate"
                {...register('metricDescription')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="metricTarget">Target</Label>
              <Input
                className="font-mono"
                id="metricTarget"
                placeholder="98"
                {...register('metricTarget')}
              />
            </div>
          </div>

          <div
            className={cn(
              'grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]',
              mode !== 'auction' && 'hidden'
            )}
          >
            <Controller
              control={control}
              name="auctionType"
              render={({ field }) => (
                <div
                  aria-label="Auction type"
                  className="grid gap-3 sm:grid-cols-2"
                  onKeyDown={(event) =>
                    handleRadioGroupKeyDown(
                      event,
                      auctionTypeOptions.map((option) => option.value),
                      field.value,
                      field.onChange
                    )
                  }
                  role="radiogroup"
                >
                  {auctionTypeOptions.map((type) => {
                    const selected = type.value === field.value;

                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          'grid gap-2 rounded-xl border border-border/68 bg-background/52 p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-primary/48 hover:bg-surface-2/52 active:scale-[0.99]',
                          selected &&
                            'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
                        )}
                        key={type.value}
                        onClick={() => field.onChange(type.value)}
                        role="radio"
                        tabIndex={selected ? 0 : -1}
                        type="button"
                      >
                        <span className="font-sans text-xs font-semibold tracking-tight">
                          {type.label}
                        </span>
                        <span className="text-xs leading-5 text-muted-foreground">
                          {type.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="maxPrice">
                  Max price
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <Input
                  aria-describedby={fieldErrors.maxPrice ? 'maxPrice-error' : undefined}
                  aria-invalid={fieldErrors.maxPrice ? true : undefined}
                  aria-required="true"
                  className="font-mono"
                  id="maxPrice"
                  min="0.01"
                  step="0.01"
                  type="number"
                  {...register('maxPrice')}
                />
                {fieldErrors.maxPrice ? (
                  <p className="text-xs leading-5 text-destructive" id="maxPrice-error">
                    {fieldErrors.maxPrice}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bidDeadline">Bid deadline hours</Label>
                <Input
                  className="font-mono"
                  id="bidDeadline"
                  min="1"
                  type="number"
                  {...register('bidDeadline')}
                />
              </div>
              <div className={cn('grid gap-2', auctionType !== 'dutch' && 'hidden')}>
                <Label htmlFor="auctionFloorPrice">
                  Floor price
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <Input
                  aria-describedby={
                    fieldErrors.auctionFloorPrice ? 'auctionFloorPrice-error' : undefined
                  }
                  aria-invalid={fieldErrors.auctionFloorPrice ? true : undefined}
                  aria-required="true"
                  className="font-mono"
                  id="auctionFloorPrice"
                  min="0.01"
                  step="0.01"
                  type="number"
                  {...register('auctionFloorPrice')}
                />
                {fieldErrors.auctionFloorPrice ? (
                  <p className="text-xs leading-5 text-destructive" id="auctionFloorPrice-error">
                    {fieldErrors.auctionFloorPrice}
                  </p>
                ) : null}
              </div>
              <div className={cn('grid gap-2', auctionType !== 'reverse_dutch' && 'hidden')}>
                <Label htmlFor="auctionStartPrice">
                  Start price
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <Input
                  aria-describedby={
                    fieldErrors.auctionStartPrice ? 'auctionStartPrice-error' : undefined
                  }
                  aria-invalid={fieldErrors.auctionStartPrice ? true : undefined}
                  aria-required="true"
                  className="font-mono"
                  id="auctionStartPrice"
                  min="0.01"
                  step="0.01"
                  type="number"
                  {...register('auctionStartPrice')}
                />
                {fieldErrors.auctionStartPrice ? (
                  <p className="text-xs leading-5 text-destructive" id="auctionStartPrice-error">
                    {fieldErrors.auctionStartPrice}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-5 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
            <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Hook &amp; evaluator (optional)
            </p>
            <div className="grid gap-2">
              <Label htmlFor="hookContract">Hook contract</Label>
              <Input
                className="font-mono"
                id="hookContract"
                placeholder="0x..."
                type="text"
                {...register('hookContract')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="evaluator">Evaluator address</Label>
              <Input
                className="font-mono"
                id="evaluator"
                placeholder="0x..."
                type="text"
                {...register('evaluator')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="evaluatorFeeBps">Evaluator fee %</Label>
              <Input
                className="font-mono"
                id="evaluatorFeeBps"
                max="100"
                min="0"
                placeholder="0"
                step="0.1"
                type="number"
                {...register('evaluatorFeeBps')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="evaluationWindow">Evaluation window (hours)</Label>
              <Input
                className="font-mono"
                id="evaluationWindow"
                min="1"
                placeholder="24"
                type="number"
                {...register('evaluationWindow')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appealWindow">Appeal window (hours)</Label>
              <Input
                className="font-mono"
                id="appealWindow"
                min="1"
                placeholder="24"
                type="number"
                {...register('appealWindow')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="disputeResolver">Dispute resolver address</Label>
              <Input
                className="font-mono"
                id="disputeResolver"
                placeholder="0x..."
                type="text"
                {...register('disputeResolver')}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
