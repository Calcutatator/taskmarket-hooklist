'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { IconChevronDown, IconSparkles } from '@tabler/icons-react';
import { TASK_DESCRIPTION_MAX_LENGTH } from '@taskmarket/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  countTags,
  type CreateTaskFieldErrors,
  handleRadioGroupKeyDown,
} from '@/lib/market/create-task-form';
import {
  composeBriefWithPreset,
  findTemplate,
  isTemplateReadinessUrlValid,
  type TaskTemplateSelection,
  VISUAL_PRESETS,
} from '@/lib/market/task-templates';
import { auctionTypeOptions } from '@/lib/market/task-mode-config';
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
  campaignState: WizardCampaignBriefState;
  campaignReadinessError?: string | null;
  campaignTitleError?: string | null;
  campaignTokenError?: string | null;
  form: UseFormReturn<WizardFormValues>;
  templateId: TaskTemplateSelection;
  fieldErrors: CreateTaskFieldErrors;
  onChangeTemplate: () => void;
  onCampaignStateChange: (state: WizardCampaignBriefState) => void;
  // When present, the template is fixed, the reward is fixed and hidden, and the
  // first token is seeded so a campaign flow (e.g. /try) cannot change vertical
  // or price.
  lock?: WizardLockConfig;
};

export function StepBrief({
  campaignState,
  campaignReadinessError,
  campaignTitleError,
  campaignTokenError,
  fieldErrors,
  form,
  lock,
  onChangeTemplate,
  onCampaignStateChange,
  templateId,
}: StepBriefProps) {
  const { control, register, setValue, watch } = form;
  const selectedTemplate = findTemplate(templateId);
  const isBlank = !selectedTemplate;
  const isLocked = Boolean(lock);

  const mode = watch('mode');
  const taskVisibility = watch('taskVisibility');
  const submissionVisibility = watch('submissionVisibility');
  const auctionType = watch('auctionType');
  const tagsValue = watch('tags');
  const tagCount = countTags(tagsValue ?? '');

  const [advancedOpen, setAdvancedOpen] = useState(mode === 'auction');
  const [publishingOpen, setPublishingOpen] = useState(
    taskVisibility !== 'public' || submissionVisibility !== 'public'
  );
  const [pendingGuidedChange, setPendingGuidedChange] = useState<
    | { key: string; type: 'readiness' | 'token'; value: string }
    | { id: string; type: 'preset' }
    | null
  >(null);
  const readinessValues = campaignState.readinessValues;
  const readinessConfirmations = campaignState.readinessConfirmations;
  const tokenValues = campaignState.tokenValues;
  const presetId = campaignState.presetId;
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

  // Recompose the brief from current tokens plus the active preset. In the
  // locked flow the visitor never edits the textarea directly, so this is the
  // single source of truth for the composed description.
  function recompose(
    nextTokens: Record<string, string>,
    nextReadiness: Record<string, string>,
    nextPresetId: string | undefined
  ) {
    if (!selectedTemplate) {
      return;
    }
    setValue(
      'description',
      composeBriefWithPreset(selectedTemplate, nextTokens, nextReadiness, nextPresetId),
      { shouldDirty: true }
    );
  }

  function applyTokenChange(key: string, value: string) {
    if (!selectedTemplate) {
      return;
    }
    const nextTokens = { ...tokenValues, [key]: value };
    onCampaignStateChange({
      hasManualEdits: false,
      presetId,
      readinessConfirmations,
      readinessValues,
      tokenValues: nextTokens,
    });
    recompose(nextTokens, readinessValues, presetId);
  }

  function handleTokenChange(key: string, value: string) {
    if (campaignState.hasManualEdits) {
      setPendingGuidedChange({ key, type: 'token', value });
      return;
    }
    applyTokenChange(key, value);
  }

  function applyReadinessChange(key: string, value: string) {
    if (!selectedTemplate) {
      return;
    }
    const nextReadiness = { ...readinessValues, [key]: value };
    const nextConfirmations = { ...readinessConfirmations, [key]: false };
    onCampaignStateChange({
      hasManualEdits: false,
      presetId,
      readinessConfirmations: nextConfirmations,
      readinessValues: nextReadiness,
      tokenValues,
    });
    recompose(tokenValues, nextReadiness, presetId);
  }

  function handleReadinessConfirmation(key: string, confirmed: boolean) {
    onCampaignStateChange({
      ...campaignState,
      readinessConfirmations: { ...readinessConfirmations, [key]: confirmed },
    });
  }

  function handleReadinessChange(key: string, value: string) {
    if (campaignState.hasManualEdits) {
      setPendingGuidedChange({ key, type: 'readiness', value });
      return;
    }
    applyReadinessChange(key, value);
  }

  function applyPresetToggle(nextId: string) {
    const resolved = presetId === nextId ? undefined : nextId;
    onCampaignStateChange({
      hasManualEdits: false,
      presetId: resolved,
      readinessConfirmations,
      readinessValues,
      tokenValues,
    });
    recompose(tokenValues, readinessValues, resolved);
  }

  function handlePresetToggle(nextId: string) {
    if (campaignState.hasManualEdits) {
      setPendingGuidedChange({ id: nextId, type: 'preset' });
      return;
    }
    applyPresetToggle(nextId);
  }

  function handleManualBriefChange(event: ChangeEvent<HTMLTextAreaElement>) {
    descriptionRegistration.onChange(event);
    onCampaignStateChange({ ...campaignState, hasManualEdits: true });
  }

  const guidedChangeDialog = (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setPendingGuidedChange(null);
      }}
      open={Boolean(pendingGuidedChange)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate this brief?</DialogTitle>
          <DialogDescription>
            Changing a guided answer rebuilds the authored brief and replaces manual edits in the
            description.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Keep manual edits
            </Button>
          </DialogClose>
          <Button
            onClick={() => {
              if (pendingGuidedChange?.type === 'token') {
                applyTokenChange(pendingGuidedChange.key, pendingGuidedChange.value);
              } else if (pendingGuidedChange?.type === 'readiness') {
                applyReadinessChange(pendingGuidedChange.key, pendingGuidedChange.value);
              } else if (pendingGuidedChange?.type === 'preset') {
                applyPresetToggle(pendingGuidedChange.id);
              }
              setPendingGuidedChange(null);
            }}
            type="button"
          >
            Regenerate brief
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (isLocked && selectedTemplate) {
    const [topicToken, audienceToken] = selectedTemplate.tokens;
    // One-line helpers per primary input, indexed to the template tokens.
    const tokenHelp: Record<string, string> = {
      audience: 'Who is this for? We tune the layout and language to them.',
      topic: 'The subject your infographic should explain, in a few words.',
    };
    const composedBrief = descriptionValue?.trim() ? descriptionValue : '';

    return (
      <div className="grid gap-6">
        {guidedChangeDialog}
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
                  aria-describedby={
                    campaignTokenError === audienceToken.key
                      ? `token-${audienceToken.key}-error`
                      : undefined
                  }
                  aria-invalid={campaignTokenError === audienceToken.key || undefined}
                  aria-required={audienceToken.required || undefined}
                  id={`token-${audienceToken.key}`}
                  onChange={(event) => handleTokenChange(audienceToken.key, event.target.value)}
                  placeholder={audienceToken.placeholder}
                  value={tokenValues[audienceToken.key] ?? ''}
                />
                {campaignTokenError === audienceToken.key ? (
                  <p
                    className="text-xs leading-5 text-destructive"
                    id={`token-${audienceToken.key}-error`}
                    role="alert"
                  >
                    Enter a target audience before reviewing and funding.
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {tokenHelp[audienceToken.key] ?? ''}
                  </p>
                )}
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
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="description">
                Description
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <span className="font-mono text-xs text-muted-foreground" aria-hidden="true">
                {(descriptionValue ?? '').length} / {TASK_DESCRIPTION_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              aria-describedby={fieldErrors.description ? 'description-error' : undefined}
              aria-invalid={fieldErrors.description ? true : undefined}
              aria-required="true"
              className="min-h-48 resize-y text-base leading-6 md:text-sm"
              id="description"
              maxLength={TASK_DESCRIPTION_MAX_LENGTH}
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
      {guidedChangeDialog}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border/75 p-5 sm:px-6">
          <p className="text-sm font-medium text-muted-foreground">
            {isBlank ? 'Blank task' : selectedTemplate?.label}
          </p>
          <Button onClick={onChangeTemplate} size="sm" type="button" variant="outline">
            Change template
          </Button>
        </CardHeader>

        <CardContent className="px-0">
          <section className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="reward">
                  {mode === 'auction' ? 'Maximum budget' : 'Reward'}
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center justify-center font-mono text-xl leading-none text-muted-foreground">
                    $
                  </span>
                  <Input
                    aria-describedby={fieldErrors.reward ? 'reward-error' : undefined}
                    aria-invalid={fieldErrors.reward ? true : undefined}
                    aria-required="true"
                    className="h-20 rounded-xl border-input bg-background/70 pl-12 font-mono text-2xl md:text-2xl"
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
                  Duration
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <div className="relative">
                  <Input
                    aria-describedby={
                      fieldErrors.duration ? 'duration-unit duration-error' : 'duration-unit'
                    }
                    aria-invalid={fieldErrors.duration ? true : undefined}
                    aria-required="true"
                    className="h-20 rounded-xl border-input bg-background/70 pr-24 font-mono text-2xl md:text-2xl"
                    id="duration"
                    min="1"
                    type="number"
                    {...register('duration')}
                  />
                  <span
                    className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-sm font-medium text-muted-foreground"
                    id="duration-unit"
                  >
                    hours
                  </span>
                </div>
                {fieldErrors.duration ? (
                  <p className="text-xs leading-5 text-destructive" id="duration-error">
                    {fieldErrors.duration}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="grid gap-5 border-t border-border/75 p-5 sm:p-6">
            {selectedTemplate && selectedTemplate.tokens.length > 0 ? (
              <div className="grid gap-3 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  Personalize
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedTemplate.tokens.map((token) => (
                    <div className="grid gap-2" key={token.key}>
                      <Label htmlFor={`token-${token.key}`}>{token.label}</Label>
                      <Input
                        aria-describedby={
                          campaignTokenError === token.key || campaignTitleError === token.key
                            ? `token-${token.key}-error`
                            : undefined
                        }
                        aria-invalid={
                          campaignTokenError === token.key || campaignTitleError === token.key
                            ? true
                            : undefined
                        }
                        aria-required={token.required || undefined}
                        id={`token-${token.key}`}
                        onChange={(event) => handleTokenChange(token.key, event.target.value)}
                        placeholder={token.placeholder}
                        value={tokenValues[token.key] ?? ''}
                      />
                      {campaignTitleError === token.key ? (
                        <p
                          className="text-xs leading-5 text-destructive"
                          id={`token-${token.key}-error`}
                          role="alert"
                        >
                          Shorten this value so the task title is 80 characters or fewer.
                        </p>
                      ) : campaignTokenError === token.key ? (
                        <p
                          className="text-xs leading-5 text-destructive"
                          id={`token-${token.key}-error`}
                        >
                          {token.label} is required.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedTemplate && selectedTemplate.readiness.length > 0 ? (
              <section
                aria-labelledby="public-task-context-heading"
                className="grid gap-4 rounded-xl border border-primary/28 bg-primary/8 p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="grid gap-1">
                  <h3
                    className="text-sm font-semibold tracking-tight text-foreground"
                    id="public-task-context-heading"
                  >
                    Public task context
                  </h3>
                  <p className="text-xs leading-5 text-muted-foreground">
                    These details are published in the worker brief. Use only public or sanitized
                    sources that open without requester follow-up.
                  </p>
                </div>
                {taskVisibility === 'private' ? (
                  <p className="rounded-lg border border-warning/46 bg-warning/12 p-3 text-xs leading-5 text-foreground">
                    This template remains public-safe. Private limits who can read it on Taskmarket,
                    but does not hide onchain activity or grant access to external systems. Keep
                    secrets out of the description.
                  </p>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-2">
                  {selectedTemplate.readiness.map((item) => {
                    const value = readinessValues[item.key] ?? '';
                    const hasError = campaignReadinessError === item.key;
                    const validUrl = item.input === 'url' && isTemplateReadinessUrlValid(value);
                    const errorMessage = !value.trim()
                      ? `${item.label} is required.`
                      : validUrl && !readinessConfirmations[item.key]
                        ? 'Confirm that this link opens without signing in.'
                        : 'Enter a complete public URL that opens without sign-in.';
                    const describedBy = [
                      `readiness-${item.key}-help`,
                      hasError ? `readiness-${item.key}-error` : null,
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const sharedProps = {
                      'aria-describedby': describedBy,
                      'aria-invalid': hasError || undefined,
                      'aria-required': item.required || undefined,
                      id: `readiness-${item.key}`,
                      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                        handleReadinessChange(item.key, event.target.value),
                      placeholder: item.placeholder,
                      value,
                    };

                    return (
                      <div className="grid gap-2" key={item.key}>
                        <Label htmlFor={`readiness-${item.key}`}>
                          {item.label}
                          {item.required ? (
                            <span aria-hidden="true" className="text-destructive">
                              *
                            </span>
                          ) : null}
                        </Label>
                        {item.input === 'longText' ? (
                          <Textarea className="min-h-24 resize-y" {...sharedProps} />
                        ) : (
                          <Input type={item.input === 'url' ? 'url' : 'text'} {...sharedProps} />
                        )}
                        <p
                          className="text-xs leading-5 text-muted-foreground"
                          id={`readiness-${item.key}-help`}
                        >
                          {item.help}
                          {item.defaultValue ? ` Default: ${item.defaultValue}` : ''}
                        </p>
                        {item.publicAccess === 'required' ? (
                          <div className="flex items-start gap-2 rounded-lg border border-border/68 bg-surface/42 p-3">
                            <Checkbox
                              checked={readinessConfirmations[item.key] ?? false}
                              id={`readiness-${item.key}-public-confirmation`}
                              onCheckedChange={(checked) =>
                                handleReadinessConfirmation(item.key, checked === true)
                              }
                            />
                            <Label
                              className="text-xs leading-5 font-normal text-foreground"
                              htmlFor={`readiness-${item.key}-public-confirmation`}
                            >
                              I confirmed this link opens without signing in.
                            </Label>
                          </div>
                        ) : null}
                        {hasError ? (
                          <p
                            className="text-xs leading-5 text-destructive"
                            id={`readiness-${item.key}-error`}
                            role="alert"
                          >
                            {errorMessage}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="description">
                  Description
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                </Label>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground" aria-hidden="true">
                    {(descriptionValue ?? '').length} / {TASK_DESCRIPTION_MAX_LENGTH}
                  </span>
                  {AI_BRIEF_ENABLED ? (
                    <Button size="sm" type="button" variant="outline">
                      <IconSparkles className="size-4" />
                      Generate with AI
                    </Button>
                  ) : null}
                </div>
              </div>
              <Textarea
                aria-describedby={
                  fieldErrors.description ? 'description-error' : 'description-hint'
                }
                aria-invalid={fieldErrors.description ? true : undefined}
                aria-required="true"
                className="min-h-56 resize-y text-base leading-6 md:text-sm"
                id="description"
                maxLength={TASK_DESCRIPTION_MAX_LENGTH}
                placeholder="Describe the outcome, inputs, deliverables, acceptance criteria, evidence, and boundaries."
                {...descriptionRegistration}
                onChange={handleManualBriefChange}
              />
              {fieldErrors.description ? (
                <p className="text-xs leading-5 text-destructive" id="description-error">
                  {fieldErrors.description}
                </p>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground" id="description-hint">
                  Published exactly as written. Link every public input workers need.
                </p>
              )}
            </div>

            <div className="grid max-w-xl gap-2">
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
                  Add up to 10 comma-separated tags to help workers find the task. {tagCount}/10
                  used.
                </p>
              )}
            </div>
          </section>

          <section className="border-t border-border/75">
            <div className="flex items-center justify-between gap-4 p-5 sm:p-6">
              <p className="text-sm font-medium text-foreground">
                {TASK_VISIBILITY_LABELS[taskVisibility]} task <span aria-hidden="true">/</span>{' '}
                {SUBMISSION_VISIBILITY_LABELS[submissionVisibility]} submissions
              </p>
              <Button
                aria-controls="publishing-options"
                aria-expanded={publishingOpen}
                aria-label={`${publishingOpen ? 'Hide' : 'Change'} publishing visibility`}
                onClick={() => setPublishingOpen((value) => !value)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {publishingOpen ? 'Done' : 'Change'}
                <IconChevronDown
                  className={cn(
                    'size-4 motion-reduce:transition-none',
                    publishingOpen && 'rotate-180'
                  )}
                  aria-hidden="true"
                />
              </Button>
            </div>

            <div
              className={cn(
                'grid items-start gap-6 border-t border-border/75 bg-surface/24 p-5 sm:p-6 lg:grid-cols-2',
                !publishingOpen && 'hidden'
              )}
              id="publishing-options"
            >
              <Controller
                control={control}
                name="taskVisibility"
                render={({ field }) => (
                  <fieldset className="grid content-start gap-3">
                    <legend className="text-sm font-semibold tracking-tight">
                      Task visibility
                    </legend>
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
                      <div className="grid gap-4 border-l-2 border-warning/46 pl-4 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="allowed-viewers">Invite wallets (optional)</Label>
                          <Controller
                            control={control}
                            name="allowedViewers"
                            render={({ field: viewersField }) => (
                              <Input
                                id="allowed-viewers"
                                onChange={viewersField.onChange}
                                placeholder="0xabc..., 0xdef..."
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
                                autoComplete="new-password"
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
                        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                          Add at least one wallet or a password. Private access does not hide the
                          task&apos;s onchain activity.
                        </p>
                        {fieldErrors.taskVisibility ? (
                          <p className="text-xs leading-5 text-destructive sm:col-span-2">
                            {fieldErrors.taskVisibility}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </fieldset>
                )}
              />

              <Controller
                control={control}
                name="submissionVisibility"
                render={({ field }) => (
                  <fieldset className="grid content-start gap-3">
                    <legend className="text-sm font-semibold tracking-tight">
                      Submission visibility
                    </legend>
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
                    {selectedTemplate?.mode === 'bounty' ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Winner only can protect losing creative entries after the task closes.
                      </p>
                    ) : null}
                  </fieldset>
                )}
              />
            </div>
          </section>
        </CardContent>

        {isLocked ? null : (
          <section className="border-t border-border/75">
            <div
              className={cn(
                'flex items-center justify-between gap-4 p-5 sm:p-6',
                advancedOpen && 'border-b border-border/75'
              )}
            >
              <CardTitle>Advanced settings</CardTitle>
              <Button
                aria-label={`${advancedOpen ? 'Hide' : 'Show'} advanced settings`}
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((value) => !value)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {advancedOpen ? 'Hide' : 'Show'}
              </Button>
            </div>
            <CardContent className={cn('grid gap-5 p-5 sm:p-6', !advancedOpen && 'hidden')}>
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
                    <Label htmlFor="bidDeadline">Bid deadline hours</Label>
                    <Input
                      className="font-mono"
                      id="bidDeadline"
                      min="1"
                      type="number"
                      {...register('bidDeadline')}
                    />
                  </div>
                  <div className="rounded-xl border border-border/68 bg-surface/42 p-3 text-xs leading-5 text-muted-foreground">
                    The maximum budget is the auction ceiling. Workers compete below that amount
                    using the selected mechanism.
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
                      <p
                        className="text-xs leading-5 text-destructive"
                        id="auctionFloorPrice-error"
                      >
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
                      <p
                        className="text-xs leading-5 text-destructive"
                        id="auctionStartPrice-error"
                      >
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
                <p
                  className="text-xs leading-5 text-muted-foreground"
                  id="reviewer-evidence-access-disclosure"
                >
                  Assigning an evaluator or dispute resolver grants that address confidential access
                  to private task details and every submission until the role is cleared. It does
                  not make the task discoverable or grant other task actions.
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
                    aria-describedby="reviewer-evidence-access-disclosure"
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
                    aria-describedby="reviewer-evidence-access-disclosure"
                    className="font-mono"
                    id="disputeResolver"
                    placeholder="0x..."
                    type="text"
                    {...register('disputeResolver')}
                  />
                </div>
              </div>
            </CardContent>
          </section>
        )}
      </Card>
    </div>
  );
}
