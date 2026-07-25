'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'motion/react';
import { useAccount } from 'wagmi';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { usePrivyAccountState, type WalletAccessStatus } from '@/components/privy-account-control';
import { StepBrief } from '@/components/market/wizard/step-brief';
import { StepPublish } from '@/components/market/wizard/step-publish';
import { StepTaskDrop } from '@/components/market/wizard/step-task-drop';
import { StepTemplate } from '@/components/market/wizard/step-template';
import { WizardStepper } from '@/components/market/wizard/wizard-stepper';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import type { MarketStats } from '@/lib/api/server';
import {
  type CreateTaskFieldErrors,
  type CreateTaskFormValues,
  DEFAULT_FORM_VALUES,
  FIELD_FOCUS_ORDER,
  validateCreateTask,
} from '@/lib/market/create-task-form';
import {
  composeBrief,
  DEFAULT_TEMPLATE_ID,
  findTemplate,
  type TaskTemplate,
  taskTemplates,
} from '@/lib/market/task-templates';
import { isPrivyConfigured } from '@/lib/privy-config';
import {
  getSessionStorageItem,
  removeSessionStorageItem,
  setSessionStorageItem,
} from '@/lib/safe-session-storage';

export type WizardFormValues = CreateTaskFormValues & { templateId: TaskTemplate['id'] };

export type WizardLockConfig = {
  templateId: TaskTemplate['id'];
  reward: string;
  prefillFirstToken?: string;
};

export type WizardVariant = 'default' | 'campaign';

export type WizardFunnelEvent = {
  name:
    | 'brief_completed'
    | 'publish_viewed'
    | 'connect_started'
    | 'funding_required'
    | 'payment_started'
    | 'task_published';
};

export type WizardCampaignBriefState = {
  hasManualEdits: boolean;
  presetId?: string;
  tokenValues: Record<string, string>;
};

type CreateTaskWizardBaseProps = {
  initialMarketStats: MarketStats | null;
  onDirtyChange?: (dirty: boolean) => void;
  onFunnelEvent?: (event: WizardFunnelEvent) => void;
};

type CreateTaskWizardProps = CreateTaskWizardBaseProps &
  (
    | { lock: WizardLockConfig; variant: 'campaign' }
    | { lock?: WizardLockConfig; variant?: 'default' }
  );

type CreateTaskWizardInternalProps = CreateTaskWizardBaseProps & {
  lock?: WizardLockConfig;
  variant: WizardVariant;
};

const STEP_BRIEF_FIELDS: Array<keyof CreateTaskFormValues> = [
  'description',
  'reward',
  'duration',
  'tags',
  'maxPrice',
  'auctionFloorPrice',
  'auctionStartPrice',
  'taskVisibility',
  'allowedViewers',
  'accessPassword',
];

const STEP_DROP_FIELDS: Array<keyof CreateTaskFormValues> = ['taskDropId', 'taskDropName'];

const WIZARD_STEPS = [
  { label: 'Template' },
  { label: 'Brief' },
  { label: 'Task Drop' },
  { label: 'Publish' },
];

const CAMPAIGN_STEPS = [{ label: 'Brief' }, { label: 'Fund & publish' }];
const STEP_EASE = [0.16, 1, 0.3, 1] as const;
const TASK_DRAFT_VERSION = 1;

type StoredTaskDraft = {
  campaignBriefState: WizardCampaignBriefState;
  stepIndex: 0 | 1 | 2 | 3;
  values: WizardFormValues;
  version: typeof TASK_DRAFT_VERSION;
};

function taskDraftStorageKey(variant: WizardVariant, lock?: WizardLockConfig) {
  if (!lock) {
    return `taskmarket:create-task-draft:v${TASK_DRAFT_VERSION}:${variant}:custom`;
  }

  const scope = `${lock.templateId}\u0000${lock.reward}\u0000${lock.prefillFirstToken ?? ''}`;
  let fingerprint = 2166136261;
  for (let index = 0; index < scope.length; index += 1) {
    fingerprint ^= scope.charCodeAt(index);
    fingerprint = Math.imul(fingerprint, 16777619);
  }

  return `taskmarket:create-task-draft:v${TASK_DRAFT_VERSION}:${variant}:${lock.templateId}:${(fingerprint >>> 0).toString(36)}`;
}

function readTaskDraft(key: string): StoredTaskDraft | null {
  try {
    const stored = getSessionStorageItem(key);
    if (!stored) {
      return null;
    }
    const draft = JSON.parse(stored) as Partial<StoredTaskDraft>;
    if (
      draft.version !== TASK_DRAFT_VERSION ||
      !draft.values ||
      !draft.campaignBriefState ||
      ![0, 1, 2, 3].includes(draft.stepIndex ?? -1)
    ) {
      removeSessionStorageItem(key);
      return null;
    }
    return draft as StoredTaskDraft;
  } catch {
    removeSessionStorageItem(key);
    return null;
  }
}

function StepTransition({
  children,
  enabled,
  stepIndex,
}: {
  children: ReactNode;
  enabled: boolean;
  stepIndex: number;
}) {
  const motionDisabled = useMotionDisabled();

  if (!enabled) {
    return <>{children}</>;
  }

  if (motionDisabled) {
    return <div className="grid gap-6">{children}</div>;
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
        className="grid gap-6"
        exit={{ filter: 'blur(2px)', opacity: 0, y: -8 }}
        initial={{ filter: 'blur(2px)', opacity: 0, y: 8 }}
        key={stepIndex}
        transition={{ duration: 0.22, ease: STEP_EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function templateValuesFrom(
  template: TaskTemplate,
  lock?: WizardLockConfig
): Partial<CreateTaskFormValues> {
  const tokenValues: Record<string, string> = {};
  if (lock?.prefillFirstToken && template.tokens[0]) {
    tokenValues[template.tokens[0].key] = lock.prefillFirstToken;
  }

  return {
    mode: template.mode,
    reward: lock?.reward ?? template.suggestedRewardUsdc,
    duration: String(template.suggestedDurationHours),
    tags: template.suggestedTags.join(', '),
    description: composeBrief(template, tokenValues),
  };
}

function initialFormValues(lock?: WizardLockConfig): WizardFormValues {
  if (!lock) {
    return { ...DEFAULT_FORM_VALUES, templateId: DEFAULT_TEMPLATE_ID };
  }

  const template = findTemplate(lock.templateId) ?? taskTemplates[0];
  return {
    ...DEFAULT_FORM_VALUES,
    ...templateValuesFrom(template, lock),
    templateId: template.id,
  };
}

function initialCampaignBriefState(lock?: WizardLockConfig): WizardCampaignBriefState {
  const template = lock ? findTemplate(lock.templateId) : undefined;
  const firstToken = template?.tokens[0];

  return {
    hasManualEdits: false,
    tokenValues:
      lock?.prefillFirstToken && firstToken ? { [firstToken.key]: lock.prefillFirstToken } : {},
  };
}

export function CreateTaskWizard({
  initialMarketStats,
  lock,
  onDirtyChange,
  onFunnelEvent,
  variant = 'default',
}: CreateTaskWizardProps) {
  if (!isPrivyConfigured()) {
    return (
      <CreateTaskWizardContent
        beginWalletAccess={() => undefined}
        initialMarketStats={initialMarketStats}
        lock={lock}
        onDirtyChange={onDirtyChange}
        onFunnelEvent={onFunnelEvent}
        ready={false}
        variant={variant}
        walletActionStatus="unavailable"
        walletConfigurationAvailable={false}
      />
    );
  }

  return (
    <CreateTaskWizardWithPrivy
      initialMarketStats={initialMarketStats}
      lock={lock}
      onDirtyChange={onDirtyChange}
      onFunnelEvent={onFunnelEvent}
      variant={variant}
    />
  );
}

function CreateTaskWizardWithPrivy({
  initialMarketStats,
  lock,
  onDirtyChange,
  onFunnelEvent,
  variant = 'default',
}: CreateTaskWizardInternalProps) {
  const { beginWalletAccess, ready, walletActionStatus } = usePrivyAccountState();

  return (
    <CreateTaskWizardContent
      beginWalletAccess={beginWalletAccess}
      initialMarketStats={initialMarketStats}
      lock={lock}
      onDirtyChange={onDirtyChange}
      onFunnelEvent={onFunnelEvent}
      ready={ready}
      variant={variant}
      walletActionStatus={walletActionStatus}
      walletConfigurationAvailable
    />
  );
}

function CreateTaskWizardContent({
  beginWalletAccess,
  initialMarketStats,
  lock,
  onDirtyChange,
  onFunnelEvent,
  ready,
  variant,
  walletActionStatus,
  walletConfigurationAvailable,
}: {
  beginWalletAccess: (returnTargetId?: string) => void;
  initialMarketStats: MarketStats | null;
  lock?: WizardLockConfig;
  onDirtyChange?: (dirty: boolean) => void;
  onFunnelEvent?: (event: WizardFunnelEvent) => void;
  ready: boolean;
  variant: WizardVariant;
  walletActionStatus: WalletAccessStatus | 'unavailable';
  walletConfigurationAvailable: boolean;
}) {
  const { address } = useAccount();
  const form = useForm<WizardFormValues>({
    defaultValues: initialFormValues(lock),
  });
  const [stepIndex, setStepIndex] = useState<0 | 1 | 2 | 3>(lock ? 1 : 0);
  const [fieldErrors, setFieldErrors] = useState<CreateTaskFieldErrors>({});
  const [campaignTokenError, setCampaignTokenError] = useState<string | null>(null);
  const [campaignBriefState, setCampaignBriefState] = useState<WizardCampaignBriefState>(() =>
    initialCampaignBriefState(lock)
  );
  const [mounted, setMounted] = useState(false);
  const draftStorageKey = taskDraftStorageKey(variant, lock);
  const draftHydratedRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastConnectedWalletRef = useRef<string | undefined>(undefined);
  const publishViewedRef = useRef(false);
  const stepFocusInitialisedRef = useRef(false);

  const templateId = form.watch('templateId');
  const { isDirty } = form.formState;

  useEffect(() => {
    const draft = readTaskDraft(draftStorageKey);
    if (draft) {
      form.reset(
        {
          ...initialFormValues(lock),
          ...draft.values,
          accessPassword: '',
        },
        { keepDefaultValues: true }
      );
      setCampaignBriefState(draft.campaignBriefState);
      setStepIndex(draft.stepIndex);
    } else if (lock) {
      form.reset(initialFormValues(lock), { keepDefaultValues: true });
      setCampaignBriefState(initialCampaignBriefState(lock));
      setStepIndex(1);
    }
    draftHydratedRef.current = true;
    setMounted(true);
  }, [draftStorageKey, form, lock]);

  useEffect(() => {
    function saveDraft() {
      if (!draftHydratedRef.current) {
        return;
      }
      const values = form.getValues();
      setSessionStorageItem(
        draftStorageKey,
        JSON.stringify({
          campaignBriefState,
          stepIndex,
          values: { ...values, accessPassword: '' },
          version: TASK_DRAFT_VERSION,
        } satisfies StoredTaskDraft)
      );
    }

    saveDraft();
    const subscription = form.watch(saveDraft);
    return () => subscription.unsubscribe();
  }, [campaignBriefState, draftStorageKey, form, stepIndex]);

  useEffect(() => {
    if (!address) {
      return;
    }

    const previousAddress = lastConnectedWalletRef.current;
    lastConnectedWalletRef.current = address;
    if (!previousAddress || previousAddress.toLowerCase() === address.toLowerCase()) {
      return;
    }

    if (form.getValues('taskDropMode') === 'existing' && form.getValues('taskDropId')) {
      form.setValue('taskDropId', '', { shouldDirty: true, shouldValidate: false });
      form.setValue('taskDropName', '', { shouldDirty: true, shouldValidate: false });
      setFieldErrors({ taskDropId: 'Wallet changed. Choose a drop again.' });
      setStepIndex(2);
    }
  }, [address, form]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange]
  );

  useEffect(() => {
    if (stepIndex === 3 && !publishViewedRef.current) {
      publishViewedRef.current = true;
      onFunnelEvent?.({ name: 'publish_viewed' });
    }
  }, [onFunnelEvent, stepIndex]);

  useEffect(() => {
    if (variant === 'campaign' && !stepFocusInitialisedRef.current) {
      stepFocusInitialisedRef.current = true;
      return;
    }

    const heading = headingRef.current;
    if (!heading) {
      return;
    }
    heading.focus({ preventScroll: true });
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [stepIndex, variant]);

  function goToStep(index: 0 | 1 | 2 | 3) {
    setStepIndex(index);
  }

  function currentFormValues(): CreateTaskFormValues {
    const all = form.getValues();
    const values = { ...all };
    delete (values as Partial<WizardFormValues>).templateId;
    return values;
  }

  function focusFirstInvalidField(errors: CreateTaskFieldErrors) {
    const node = formRef.current;
    if (!node) {
      return;
    }
    for (const name of FIELD_FOCUS_ORDER) {
      if (!errors[name]) {
        continue;
      }
      const field = node.querySelector<HTMLElement>(`#${name}`);
      if (field) {
        field.focus();
        field.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  }

  function applyTemplate(template: TaskTemplate) {
    if (template.id === templateId) {
      return;
    }
    if (isDirty) {
      const confirmed = window.confirm(
        'Switching templates will replace your current brief and settings. Continue?'
      );
      if (!confirmed) {
        return;
      }
    }
    setFieldErrors({});
    form.reset({
      ...DEFAULT_FORM_VALUES,
      ...templateValuesFrom(template),
      templateId: template.id,
    });
  }

  function handleExpressPublish() {
    setFieldErrors({});
    const values = currentFormValues();
    const errors = validateCreateTask(values);
    if (errors) {
      setFieldErrors(errors);
      goToStep(1);
      window.requestAnimationFrame(() => focusFirstInvalidField(errors));
      return;
    }
    onFunnelEvent?.({ name: 'brief_completed' });
    goToStep(2);
  }

  function handleContinueFromBrief() {
    setFieldErrors({});
    if (lock) {
      const campaignTemplate = findTemplate(lock.templateId);
      const missingToken = campaignTemplate?.tokens.find(
        (token) => token.required && !campaignBriefState.tokenValues[token.key]?.trim()
      );
      if (missingToken) {
        setCampaignTokenError(missingToken.key);
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(`#token-${missingToken.key}`)?.focus();
        });
        return;
      }
    }
    setCampaignTokenError(null);
    const values = currentFormValues();
    const errors = validateCreateTask(values, STEP_BRIEF_FIELDS);
    if (errors) {
      setFieldErrors(errors);
      window.requestAnimationFrame(() => focusFirstInvalidField(errors));
      return;
    }
    onFunnelEvent?.({ name: 'brief_completed' });
    goToStep(variant === 'campaign' ? 3 : 2);
  }

  function handleContinueToPublish() {
    setFieldErrors({});
    const values = currentFormValues();
    const errors = validateCreateTask(values, STEP_DROP_FIELDS);
    if (errors) {
      setFieldErrors(errors);
      window.requestAnimationFrame(() => focusFirstInvalidField(errors));
      return;
    }
    goToStep(3);
  }

  function handlePublishValidationError(errors: CreateTaskFieldErrors) {
    setFieldErrors(errors);
    goToStep(errors.taskDropId || errors.taskDropName ? 2 : 1);
    window.requestAnimationFrame(() => focusFirstInvalidField(errors));
  }

  const stepHeading =
    stepIndex === 0
      ? 'Choose a template'
      : stepIndex === 1
        ? 'Write the brief'
        : stepIndex === 2
          ? 'Choose a Task Drop'
          : variant === 'campaign'
            ? 'Fund and publish'
            : 'Review and publish';

  const showStepHeading = !(lock && stepIndex === 1);
  const visibleSteps =
    variant === 'campaign' ? CAMPAIGN_STEPS : lock ? WIZARD_STEPS.slice(1) : WIZARD_STEPS;
  const stepperCurrent =
    variant === 'campaign' ? (stepIndex === 3 ? 1 : 0) : lock ? stepIndex - 1 : stepIndex;

  function handleStepperClick(index: number) {
    if (variant === 'campaign') {
      goToStep(index === 0 ? 1 : 3);
      return;
    }
    goToStep((lock ? index + 1 : index) as 0 | 1 | 2 | 3);
  }

  return (
    <div className="grid gap-6">
      <WizardStepper
        current={stepperCurrent}
        onStepClick={handleStepperClick}
        steps={visibleSteps}
      />

      <Form {...form}>
        <form className="grid gap-6" onSubmit={(event) => event.preventDefault()} ref={formRef}>
          <h2
            className={
              showStepHeading
                ? 'font-display text-2xl font-semibold tracking-tight outline-none'
                : 'sr-only'
            }
            ref={headingRef}
            tabIndex={-1}
          >
            {stepHeading}
          </h2>

          <StepTransition enabled={Boolean(lock)} stepIndex={stepIndex}>
            {stepIndex === 0 && !lock ? (
              <StepTemplate
                applyTemplate={applyTemplate}
                marketStats={initialMarketStats}
                onCustomize={() => goToStep(1)}
                onExpressPublish={handleExpressPublish}
                templateId={templateId}
              />
            ) : null}

            {stepIndex === 1 ? (
              <>
                <StepBrief
                  campaignState={lock ? campaignBriefState : undefined}
                  campaignTokenError={campaignTokenError}
                  fieldErrors={fieldErrors}
                  form={form}
                  lock={lock}
                  onChangeTemplate={() => goToStep(0)}
                  onCampaignStateChange={
                    lock
                      ? (state) => {
                          setCampaignBriefState(state);
                          setCampaignTokenError(null);
                        }
                      : undefined
                  }
                  templateId={templateId}
                />
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                  {lock ? (
                    <span />
                  ) : (
                    <Button onClick={() => goToStep(0)} type="button" variant="ghost">
                      Back
                    </Button>
                  )}
                  <Button onClick={handleContinueFromBrief} type="button">
                    {variant === 'campaign' ? 'Review and fund' : 'Continue to Task Drop'}
                  </Button>
                </div>
              </>
            ) : null}

            {stepIndex === 2 && variant !== 'campaign' ? (
              <>
                <StepTaskDrop
                  beginWalletAccess={beginWalletAccess}
                  fieldErrors={fieldErrors}
                  form={form}
                  walletActionStatus={walletActionStatus}
                />
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                  <Button onClick={() => goToStep(1)} type="button" variant="ghost">
                    Back to brief
                  </Button>
                  <Button onClick={handleContinueToPublish} type="button">
                    Continue to publish
                  </Button>
                </div>
              </>
            ) : null}

            {stepIndex === 3 ? (
              <>
                <StepPublish
                  beginWalletAccess={beginWalletAccess}
                  form={form}
                  marketStats={initialMarketStats}
                  onEditBrief={() => goToStep(1)}
                  onEditDrop={() => goToStep(2)}
                  onFunnelEvent={onFunnelEvent}
                  onPublished={() => removeSessionStorageItem(draftStorageKey)}
                  onValidationError={handlePublishValidationError}
                  ready={mounted && ready}
                  variant={variant}
                  walletActionStatus={walletActionStatus}
                  walletConfigurationAvailable={walletConfigurationAvailable}
                />
                {variant === 'campaign' ? null : (
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                    <Button onClick={() => goToStep(2)} type="button" variant="ghost">
                      Back to Task Drop
                    </Button>
                  </div>
                )}
              </>
            ) : null}
          </StepTransition>
        </form>
      </Form>
    </div>
  );
}
