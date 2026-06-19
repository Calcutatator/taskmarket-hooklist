'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { usePrivy } from '@privy-io/react-auth';

import { StepBrief } from '@/components/market/wizard/step-brief';
import { StepPublish } from '@/components/market/wizard/step-publish';
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
import { composeBrief, DEFAULT_TEMPLATE_ID, type TaskTemplate } from '@/lib/market/task-templates';
import { isPrivyConfigured } from '@/lib/privy-config';

export type WizardFormValues = CreateTaskFormValues & { templateId: TaskTemplate['id'] };

// Fields validated when leaving the Brief step (step 2). Auction sub-fields are
// included so the auto-opened advanced disclosure catches max/floor/start errors.
const STEP_BRIEF_FIELDS: Array<keyof CreateTaskFormValues> = [
  'description',
  'reward',
  'duration',
  'tags',
  'maxPrice',
  'auctionFloorPrice',
  'auctionStartPrice',
];

const WIZARD_STEPS = [{ label: 'Template' }, { label: 'Brief' }, { label: 'Publish' }];

// Map a template's suggested values onto the form value shape (UI units/strings).
function templateValuesFrom(template: TaskTemplate): Partial<CreateTaskFormValues> {
  return {
    mode: template.mode,
    reward: template.suggestedRewardUsdc,
    duration: String(template.suggestedDurationHours),
    tags: template.suggestedTags.join(', '),
    description: composeBrief(template, {}),
  };
}

export function CreateTaskWizard({
  initialMarketStats,
}: {
  initialMarketStats: MarketStats | null;
}) {
  if (!isPrivyConfigured()) {
    return (
      <CreateTaskWizardContent
        connectOrCreateWallet={() => undefined}
        initialMarketStats={initialMarketStats}
        ready={false}
      />
    );
  }

  return <CreateTaskWizardWithPrivy initialMarketStats={initialMarketStats} />;
}

function CreateTaskWizardWithPrivy({
  initialMarketStats,
}: {
  initialMarketStats: MarketStats | null;
}) {
  const { connectOrCreateWallet, ready } = usePrivy();

  return (
    <CreateTaskWizardContent
      connectOrCreateWallet={connectOrCreateWallet}
      initialMarketStats={initialMarketStats}
      ready={ready}
    />
  );
}

function CreateTaskWizardContent({
  connectOrCreateWallet,
  initialMarketStats,
  ready,
}: {
  connectOrCreateWallet: () => void | Promise<void>;
  initialMarketStats: MarketStats | null;
  ready: boolean;
}) {
  const form = useForm<WizardFormValues>({
    defaultValues: { ...DEFAULT_FORM_VALUES, templateId: DEFAULT_TEMPLATE_ID },
  });
  const [stepIndex, setStepIndex] = useState<0 | 1 | 2>(0);
  const [fieldErrors, setFieldErrors] = useState<CreateTaskFieldErrors>({});
  const [mounted, setMounted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const templateId = form.watch('templateId');
  // Read isDirty during render so react-hook-form subscribes to dirty tracking.
  // Accessing it only inside the applyTemplate handler leaves it stale (false),
  // which would skip the re-select confirmation guard.
  const { isDirty } = form.formState;

  useEffect(() => {
    setMounted(true);
  }, []);

  // On step change, move focus to the heading and bring it into view.
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) {
      return;
    }
    heading.focus({ preventScroll: true });
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [stepIndex]);

  function goToStep(index: 0 | 1 | 2) {
    setStepIndex(index);
  }

  // Form values without the wizard-only templateId, ready for validate/build.
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
    goToStep(2);
  }

  function handleContinueToPublish() {
    setFieldErrors({});
    const values = currentFormValues();
    const errors = validateCreateTask(values, STEP_BRIEF_FIELDS);
    if (errors) {
      setFieldErrors(errors);
      window.requestAnimationFrame(() => focusFirstInvalidField(errors));
      return;
    }
    goToStep(2);
  }

  function handlePublishValidationError(errors: CreateTaskFieldErrors) {
    setFieldErrors(errors);
    goToStep(1);
    window.requestAnimationFrame(() => focusFirstInvalidField(errors));
  }

  const stepHeading =
    stepIndex === 0
      ? 'Choose a template'
      : stepIndex === 1
        ? 'Write the brief'
        : 'Review and publish';

  return (
    <div className="grid gap-6">
      <WizardStepper
        current={stepIndex}
        onStepClick={(index) => goToStep(index as 0 | 1 | 2)}
        steps={WIZARD_STEPS}
      />

      <Form {...form}>
        <form className="grid gap-6" onSubmit={(event) => event.preventDefault()} ref={formRef}>
          <h2
            className="font-display text-2xl font-semibold tracking-tight outline-none"
            ref={headingRef}
            tabIndex={-1}
          >
            {stepHeading}
          </h2>

          {stepIndex === 0 ? (
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
                fieldErrors={fieldErrors}
                form={form}
                onChangeTemplate={() => goToStep(0)}
                templateId={templateId}
              />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button onClick={() => goToStep(0)} type="button" variant="ghost">
                  Back
                </Button>
                <Button onClick={handleContinueToPublish} type="button">
                  Continue to publish
                </Button>
              </div>
            </>
          ) : null}

          {stepIndex === 2 ? (
            <>
              <StepPublish
                connectOrCreateWallet={connectOrCreateWallet}
                form={form}
                marketStats={initialMarketStats}
                onEditBrief={() => goToStep(1)}
                onValidationError={handlePublishValidationError}
                ready={mounted && ready}
              />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button onClick={() => goToStep(1)} type="button" variant="ghost">
                  Back to brief
                </Button>
              </div>
            </>
          ) : null}
        </form>
      </Form>
    </div>
  );
}
