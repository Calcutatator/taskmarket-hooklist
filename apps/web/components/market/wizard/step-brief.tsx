'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
  composeBriefWithPreset,
  findTemplate,
  type TaskTemplate,
  taskTemplates,
  VISUAL_PRESETS,
} from '@/lib/market/task-templates';
import { auctionTypeOptions, taskModeOptions } from '@/lib/market/task-mode-config';
import {
  TASK_VISIBILITY_LABELS,
  TASK_VISIBILITY_DISCLAIMERS,
  SUBMISSION_VISIBILITY_DISCLAIMERS,
  SUBMISSION_VISIBILITY_LABELS,
} from '@/lib/market/status-config';
import { cn } from '@/lib/utils';

import type {
  WizardCampaignBriefState,
  WizardFormValues,
  WizardLockConfig,
} from '../create-task-wizard';

// Flag for the forward-compatible AI brief seam. The button is built but not
// rendered until real generation lands; flipping this to true wires it up.
const AI_BRIEF_ENABLED = false;

const SUBMISSION_VISIBILITY_VALUES: Array<'public' | 'reveal_all' | 'winner_only' | 'never'> = [
  'public',
  'reveal_all',
  'winner_only',
  'never',
];

const TASK_VISIBILITY_VALUES: Array<'public' | 'unlisted' | 'private'> = [
  'public',
  'unlisted',
  'private',
];

type StepBriefProps = {
  campaignState?: WizardCampaignBriefState;
  campaignTokenError?: string | null;
  form: UseFormReturn<WizardFormValues>;
  templateId: TaskTemplate['id'];
  fieldErrors: CreateTaskFieldErrors;
  onChangeTemplate: () => void;
  onCampaignStateChange?: (state: WizardCampaignBriefState) => void;
  // When present, the template is fixed, the reward is fixed and hidden, and the
  // first token is seeded so a campaign flow (e.g. /try) cannot change vertical
  // or price.
  lock?: WizardLockConfig;
};

export function StepBrief({
  campaignState,
  campaignTokenError,
  fieldErrors,
  form,
  lock,
  onChangeTemplate,
  onCampaignStateChange,
  templateId,
}: StepBriefProps) {
  const { control, register, setValue, watch } = form;
  const selectedTemplate: TaskTemplate = findTemplate(templateId) ?? taskTemplates[0];
  const isCustom = selectedTemplate.id === 'custom';
  const isLocked = Boolean(lock);

  const mode = watch('mode');
  const auctionType = watch('auctionType');
  const tagsValue = watch('tags');
  const tagCount = countTags(tagsValue ?? '');

  const [advancedOpen, setAdvancedOpen] = useState(mode === 'auction');
  const [localTokenValues, setLocalTokenValues] = useState<Record<string, string>>(() => {
    if (lock?.prefillFirstToken && selectedTemplate.tokens[0]) {
      return { [selectedTemplate.tokens[0].key]: lock.prefillFirstToken };
    }
    return {};
  });
  // Selected visual-direction preset (locked flow only). Undefined until the
  // visitor picks a chip; toggling the active chip clears it back to undefined.
  const [localPresetId, setLocalPresetId] = useState<string | undefined>(undefined);
  const tokenValues = campaignState?.tokenValues ?? localTokenValues;
  const presetId = campaignState ? campaignState.presetId : localPresetId;
  const descriptionValue = watch('description');
  const descriptionRegistration = register('description');

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

  // Reset personalize tokens only when the template id actually changes. A
  // previous "skip first effect" flag cleared campaign prefills during React's
  // development Strict Mode effect replay.
  const previousTemplateIdRef = useRef(templateId);
  useEffect(() => {
    if (previousTemplateIdRef.current === templateId) {
      return;
    }
    previousTemplateIdRef.current = templateId;
    setLocalTokenValues({});
  }, [templateId]);

  const contextStripClassName = useMemo(
    () =>
      cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4',
        isCustom ? 'border-border/68 bg-surface/42' : 'border-primary/28 bg-primary/8'
      ),
    [isCustom]
  );

  // Recompose the brief from current tokens plus the active preset. In the
  // locked flow the visitor never edits the textarea directly, so this is the
  // single source of truth for the composed description.
  function recompose(nextTokens: Record<string, string>, nextPresetId: string | undefined) {
    setValue('description', composeBriefWithPreset(selectedTemplate, nextTokens, nextPresetId), {
      shouldDirty: true,
    });
  }

  function confirmCampaignRegeneration() {
    if (!campaignState?.hasManualEdits) {
      return true;
    }

    return window.confirm(
      'Changing a guided answer will replace your manual brief edits. Continue?'
    );
  }

  function handleTokenChange(key: string, value: string) {
    if (isLocked && !confirmCampaignRegeneration()) {
      return;
    }

    const nextTokens = { ...tokenValues, [key]: value };
    if (isLocked) {
      onCampaignStateChange?.({
        hasManualEdits: false,
        presetId,
        tokenValues: nextTokens,
      });
      recompose(nextTokens, presetId);
      return;
    }
    setLocalTokenValues(nextTokens);
    setValue('description', composeBrief(selectedTemplate, nextTokens), {
      shouldDirty: true,
    });
  }

  function handlePresetToggle(nextId: string) {
    if (!confirmCampaignRegeneration()) {
      return;
    }

    const resolved = presetId === nextId ? undefined : nextId;
    if (isLocked) {
      onCampaignStateChange?.({
        hasManualEdits: false,
        presetId: resolved,
        tokenValues,
      });
    } else {
      setLocalPresetId(resolved);
    }
    recompose(tokenValues, resolved);
  }

  function handleManualBriefChange(event: ChangeEvent<HTMLTextAreaElement>) {
    descriptionRegistration.onChange(event);
    if (campaignState) {
      onCampaignStateChange?.({ ...campaignState, hasManualEdits: true });
    }
  }

  if (isLocked) {
    const [topicToken, audienceToken] = selectedTemplate.tokens;
    // One-line helpers per primary input, indexed to the template tokens.
    const tokenHelp: Record<string, string> = {
      audience: 'Who is this for? We tune the layout and language to them.',
      topic: 'The subject your infographic should explain, in a few words.',
    };
    const composedBrief = descriptionValue?.trim() ? descriptionValue : '';

    return (
      <div className="grid gap-6">
        <div className="grid gap-4 rounded-xl border border-primary/28 bg-primary/8 p-4 sm:p-5">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
            Two quick answers
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {topicToken ? (
              <div className="grid gap-2">
                <Label htmlFor={`token-${topicToken.key}`}>{topicToken.label}</Label>
                <Input
                  aria-describedby={
                    campaignTokenError === topicToken.key
                      ? `token-${topicToken.key}-error`
                      : undefined
                  }
                  aria-invalid={campaignTokenError === topicToken.key || undefined}
                  aria-required={topicToken.required || undefined}
                  id={`token-${topicToken.key}`}
                  onChange={(event) => handleTokenChange(topicToken.key, event.target.value)}
                  placeholder={topicToken.placeholder}
                  value={tokenValues[topicToken.key] ?? ''}
                />
                {campaignTokenError === topicToken.key ? (
                  <p
                    className="text-xs leading-5 text-destructive"
                    id={`token-${topicToken.key}-error`}
                    role="alert"
                  >
                    Enter a topic before reviewing and funding.
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {tokenHelp[topicToken.key] ?? ''}
                  </p>
                )}
              </div>
            ) : null}
            {audienceToken ? (
              <div className="grid gap-2">
                <Label htmlFor={`token-${audienceToken.key}`}>{audienceToken.label}</Label>
                <Input
                  aria-required={audienceToken.required || undefined}
                  id={`token-${audienceToken.key}`}
                  onChange={(event) => handleTokenChange(audienceToken.key, event.target.value)}
                  placeholder={audienceToken.placeholder}
                  value={tokenValues[audienceToken.key] ?? ''}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {tokenHelp[audienceToken.key] ?? ''}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
            Visual direction
          </p>
          <div
            aria-label="Visual direction"
            className="grid max-w-xl grid-cols-3 overflow-hidden rounded-md border border-border/68 bg-background"
            role="group"
          >
            {VISUAL_PRESETS.map((preset) => {
              const active = presetId === preset.id;
              return (
                <Button
                  aria-pressed={active}
                  className="h-11 rounded-none border-r border-border/68 px-2 last:border-r-0"
                  data-active={active}
                  key={preset.id}
                  onClick={() => handlePresetToggle(preset.id)}
                  type="button"
                  variant={active ? 'secondary' : 'ghost'}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Optional. Pick a look and we add it to the brief.
          </p>
        </div>

        <details className="group grid gap-3 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
            <span>Your brief</span>
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground group-open:hidden">
              Edit the full brief
            </span>
            <span className="hidden font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground group-open:inline">
              Hide editor
            </span>
          </summary>
          <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground group-open:hidden">
            {composedBrief}
          </p>
          <div className="hidden group-open:grid group-open:gap-2">
            <Label htmlFor="description">
              Description
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </Label>
            <Textarea
              aria-describedby={fieldErrors.description ? 'description-error' : undefined}
              aria-invalid={fieldErrors.description ? true : undefined}
              aria-required="true"
              className="min-h-48 resize-y text-base leading-6 md:text-sm"
              id="description"
              maxLength={2000}
              {...descriptionRegistration}
              onChange={handleManualBriefChange}
            />
            {fieldErrors.description ? (
              <p className="text-xs leading-5 text-destructive" id="description-error">
                {fieldErrors.description}
              </p>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                Manual edits are preserved. Changing a guided answer later asks before rebuilding
                this text.
              </p>
            )}
          </div>
        </details>

        {/* Reward is fixed for the campaign flow. Keep the value in form state via
            a hidden input; duration and tags stay in form state via hidden inputs
            too so the publish step and payload are unchanged. */}
        <input type="hidden" {...register('reward')} />
        <input type="hidden" {...register('duration')} />
        <input type="hidden" {...register('tags')} />
      </div>
    );
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
        {isLocked ? null : (
          <Button onClick={onChangeTemplate} size="sm" type="button" variant="outline">
            Change template
          </Button>
        )}
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
              {...descriptionRegistration}
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

          <Controller
            control={control}
            name="taskVisibility"
            render={({ field }) => (
              <div className="grid gap-2 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
                <span className="text-sm font-semibold tracking-tight">Task visibility</span>
                <div
                  aria-label="Task visibility"
                  className="grid grid-cols-3 gap-2"
                  onKeyDown={(event) =>
                    handleRadioGroupKeyDown(
                      event,
                      TASK_VISIBILITY_VALUES,
                      field.value,
                      field.onChange
                    )
                  }
                  role="radiogroup"
                >
                  {TASK_VISIBILITY_VALUES.map((value) => {
                    const selected = value === field.value;
                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          'rounded-lg border border-border/68 bg-background/46 px-3 py-2 text-center text-sm font-medium transition-[background-color,border-color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:border-primary/48',
                          selected &&
                            'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
                        )}
                        key={value}
                        onClick={() => field.onChange(value)}
                        role="radio"
                        tabIndex={selected ? 0 : -1}
                        type="button"
                      >
                        {TASK_VISIBILITY_LABELS[value]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {TASK_VISIBILITY_DISCLAIMERS[field.value]}
                </p>
                {field.value === 'private' ? (
                  <div className="grid gap-3 pt-1">
                    <div className="grid gap-1.5">
                      <Label htmlFor="allowed-viewers">Invite wallets (optional)</Label>
                      <Controller
                        control={control}
                        name="allowedViewers"
                        render={({ field: viewersField }) => (
                          <Input
                            id="allowed-viewers"
                            onChange={viewersField.onChange}
                            placeholder="0xabc..., 0xdef... (comma-separated)"
                            value={viewersField.value}
                          />
                        )}
                      />
                      {fieldErrors.allowedViewers ? (
                        <p className="text-xs leading-5 text-destructive">
                          {fieldErrors.allowedViewers}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="access-password">Password (optional)</Label>
                      <Controller
                        control={control}
                        name="accessPassword"
                        render={({ field: passwordField }) => (
                          <Input
                            id="access-password"
                            minLength={8}
                            onChange={passwordField.onChange}
                            placeholder="At least 8 characters"
                            type="password"
                            value={passwordField.value}
                          />
                        )}
                      />
                      {fieldErrors.accessPassword ? (
                        <p className="text-xs leading-5 text-destructive">
                          {fieldErrors.accessPassword}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      At least one of invited wallets or a password is required for a private task.
                      More wallets can be invited later from the task&apos;s dashboard.
                    </p>
                    {fieldErrors.taskVisibility ? (
                      <p className="text-xs leading-5 text-destructive">
                        {fieldErrors.taskVisibility}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          />

          <Controller
            control={control}
            name="submissionVisibility"
            render={({ field }) => (
              <div className="grid gap-2 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
                <span className="text-sm font-semibold tracking-tight">Submission visibility</span>
                <div
                  aria-label="Submission visibility"
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                  onKeyDown={(event) =>
                    handleRadioGroupKeyDown(
                      event,
                      SUBMISSION_VISIBILITY_VALUES,
                      field.value,
                      field.onChange
                    )
                  }
                  role="radiogroup"
                >
                  {SUBMISSION_VISIBILITY_VALUES.map((value) => {
                    const selected = value === field.value;
                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          'rounded-lg border border-border/68 bg-background/46 px-3 py-2 text-center text-sm font-medium transition-[background-color,border-color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:border-primary/48',
                          selected &&
                            'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
                        )}
                        key={value}
                        onClick={() => field.onChange(value)}
                        role="radio"
                        tabIndex={selected ? 0 : -1}
                        type="button"
                      >
                        {SUBMISSION_VISIBILITY_LABELS[value]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {SUBMISSION_VISIBILITY_DISCLAIMERS[field.value]}
                </p>
              </div>
            )}
          />

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
            {isLocked ? (
              // Reward is fixed for a locked campaign flow. Keep the value in
              // form state via a hidden input and surface it read-only so the
              // cost breakdown on the publish step stays accurate.
              <div className="grid gap-2">
                <Label htmlFor="reward-locked">Reward</Label>
                <div className="flex h-9 items-center rounded-md border border-border/68 bg-surface/42 px-3 font-mono text-sm text-foreground shadow-[var(--shadow-soft)]">
                  ${lock?.reward}
                </div>
                <input id="reward-locked" type="hidden" {...register('reward')} />
                <p className="text-xs leading-5 text-muted-foreground">Fixed for this flow.</p>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="reward">
                  Reward
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-1 -mt-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center font-mono text-sm leading-none text-muted-foreground">
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
            )}
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

      {isLocked ? null : (
        <Card>
          <CardHeader className="border-b border-border/75">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Mode &amp; advanced settings</CardTitle>
                <CardDescription className="mt-2">
                  Choose how a worker is selected and paid, plus optional hook and evaluator
                  settings.
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
                          selected &&
                            'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
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
                How long workers have to submit a pitch before the window closes.
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
      )}
    </div>
  );
}
