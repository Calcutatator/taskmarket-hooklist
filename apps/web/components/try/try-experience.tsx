'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CreateTaskWizard,
  type WizardFunnelEvent,
  type WizardLockConfig,
} from '@/components/market/create-task-wizard';
import { formatUsdcUnits } from '@/lib/format';
import {
  getSessionStorageItem,
  removeSessionStorageItem,
  setSessionStorageItem,
} from '@/lib/safe-session-storage';
import type { TryDrop } from '@/lib/try/drops';
import { emitTryFunnelEvent, type TryFunnelEventName } from '@/lib/try/events';

import { TryFinalCta } from './try-final-cta';
import { TryGallery } from './try-gallery';
import { TryHero } from './try-hero';
import { TryHowItWorks } from './try-how-it-works';

const TRY_REWARD_USD = '1';
const TRY_DRAFT_STORAGE_KEY = 'taskmarket:try-draft:v1';
const TRY_PLATFORM_FEE_BPS = BigInt(process.env.NEXT_PUBLIC_PLATFORM_FEE_BPS ?? 750);
const TRY_REWARD_BASE_UNITS = 1_000_000n;
const TRY_WORKER_PAYOUT_USD = formatUsdcUnits(
  ((TRY_REWARD_BASE_UNITS * (10_000n - TRY_PLATFORM_FEE_BPS)) / 10_000n).toString()
).replace(/ USDC$/, '');

type TryExperienceProps = {
  drops: readonly TryDrop[];
};

type PromptError = {
  message: string;
  source: 'hero' | 'closing';
};

const WIZARD_EVENT_NAMES: Record<WizardFunnelEvent['name'], TryFunnelEventName> = {
  brief_completed: 'try_brief_completed',
  connect_started: 'try_connect_started',
  funding_required: 'try_funding_required',
  payment_started: 'try_payment_started',
  publish_viewed: 'try_publish_viewed',
  task_published: 'try_task_published',
};

export function TryExperience({ drops }: TryExperienceProps) {
  const [draftDirty, setDraftDirty] = useState(false);
  const [promptError, setPromptError] = useState<PromptError | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [submittedTopic, setSubmittedTopic] = useState('');
  const [wizardVersion, setWizardVersion] = useState(0);
  const [draftRestored, setDraftRestored] = useState(false);
  const builderRef = useRef<HTMLElement>(null);
  const closingInputRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const topicStartedRef = useRef(false);

  useEffect(() => {
    emitTryFunnelEvent({ name: 'try_view' });
  }, []);

  useEffect(() => {
    try {
      const stored = getSessionStorageItem(TRY_DRAFT_STORAGE_KEY);
      if (stored) {
        const draft = JSON.parse(stored) as {
          promptValue?: unknown;
          submittedTopic?: unknown;
          version?: unknown;
        };
        if (draft.version === 1) {
          if (typeof draft.promptValue === 'string') {
            setPromptValue(draft.promptValue);
          }
          if (typeof draft.submittedTopic === 'string') {
            setSubmittedTopic(draft.submittedTopic);
          }
        } else {
          removeSessionStorageItem(TRY_DRAFT_STORAGE_KEY);
        }
      }
    } catch {
      removeSessionStorageItem(TRY_DRAFT_STORAGE_KEY);
    } finally {
      setDraftRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!draftRestored) {
      return;
    }
    setSessionStorageItem(
      TRY_DRAFT_STORAGE_KEY,
      JSON.stringify({ promptValue, submittedTopic, version: 1 })
    );
  }, [draftRestored, promptValue, submittedTopic]);

  useEffect(() => {
    const node = builderRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }

    let emitted = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !emitted) {
          emitted = true;
          emitTryFunnelEvent({ name: 'try_builder_viewed' });
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const focusBuilder = useCallback(() => {
    const node = builderRef.current;
    if (!node) {
      return;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('#token-audience')?.focus({ preventScroll: true });
    });
  }, []);

  const handlePromptChange = useCallback((value: string) => {
    setPromptValue(value);
    setPromptError(null);

    if (value.trim() && !topicStartedRef.current) {
      topicStartedRef.current = true;
      emitTryFunnelEvent({ name: 'try_topic_started' });
    }
  }, []);

  const submitTopic = useCallback(
    (source: 'hero' | 'closing') => {
      const nextTopic = promptValue.trim();
      if (!nextTopic) {
        setPromptError({
          message: 'Enter a topic before building your brief.',
          source,
        });
        const input = source === 'hero' ? heroInputRef.current : closingInputRef.current;
        input?.focus();
        return;
      }

      if (draftDirty && nextTopic !== submittedTopic) {
        const confirmed = window.confirm(
          'This will replace the brief you have started. Continue with the new topic?'
        );
        if (!confirmed) {
          return;
        }
      }

      setPromptError(null);
      emitTryFunnelEvent({ name: 'try_topic_submitted', source });

      if (nextTopic !== submittedTopic) {
        setSubmittedTopic(nextTopic);
        setWizardVersion((version) => version + 1);
      }

      window.requestAnimationFrame(focusBuilder);
    },
    [draftDirty, focusBuilder, promptValue, submittedTopic]
  );

  const handleRemix = useCallback((drop: TryDrop) => {
    setPromptValue(drop.shortTopic);
    setPromptError(null);
    emitTryFunnelEvent({ name: 'try_drop_remix', source: 'proof', taskId: drop.taskId });

    window.requestAnimationFrame(() => {
      const input = closingInputRef.current;
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
      input?.select();
    });
  }, []);

  const handleWizardEvent = useCallback((event: WizardFunnelEvent) => {
    emitTryFunnelEvent({ name: WIZARD_EVENT_NAMES[event.name], source: 'wizard' });
    if (event.name === 'task_published') {
      removeSessionStorageItem(TRY_DRAFT_STORAGE_KEY);
    }
  }, []);

  const lock: WizardLockConfig = useMemo(
    () => ({
      prefillFirstToken: submittedTopic || undefined,
      reward: TRY_REWARD_USD,
      templateId: 'infographic',
    }),
    [submittedTopic]
  );

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)] bg-background">
      <TryHero
        disabled={!draftRestored}
        drops={drops}
        error={promptError?.source === 'hero' ? promptError.message : null}
        inputRef={heroInputRef}
        onChange={handlePromptChange}
        onSubmit={() => submitTopic('hero')}
        value={promptValue}
      />

      <section
        aria-labelledby="try-wizard-title"
        className="scroll-mt-4 border-b border-border/58 px-4 py-14 sm:px-6 sm:py-20 lg:px-8"
        id="try-builder"
        ref={builderRef}
      >
        <div className="mx-auto grid w-full max-w-5xl gap-8">
          <div className="grid gap-3">
            <p className="font-mono text-xs font-semibold uppercase text-primary">Your brief</p>
            <h2
              className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
              id="try-wizard-title"
            >
              Turn the idea into a clear brief.
            </h2>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              Add the audience and an optional visual direction. You can inspect and edit every word
              before funding.
            </p>
          </div>
          <dl className="grid gap-px overflow-hidden border border-border/58 bg-border/58 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1 bg-background p-4">
              <dt className="font-mono text-[0.7rem] font-semibold uppercase text-muted-foreground">
                Total
              </dt>
              <dd className="text-sm font-semibold text-foreground">$1</dd>
            </div>
            <div className="grid gap-1 bg-background p-4">
              <dt className="font-mono text-[0.7rem] font-semibold uppercase text-muted-foreground">
                Worker payout
              </dt>
              <dd className="text-sm font-semibold text-foreground">${TRY_WORKER_PAYOUT_USD}</dd>
            </div>
            <div className="grid gap-1 bg-background p-4">
              <dt className="font-mono text-[0.7rem] font-semibold uppercase text-muted-foreground">
                Expected window
              </dt>
              <dd className="text-sm font-semibold text-foreground">Within 72 hours</dd>
            </div>
            <div className="grid gap-1 bg-background p-4">
              <dt className="font-mono text-[0.7rem] font-semibold uppercase text-muted-foreground">
                If nobody delivers
              </dt>
              <dd className="text-sm font-semibold text-foreground">Refundable after expiry</dd>
            </div>
          </dl>
          <CreateTaskWizard
            initialMarketStats={null}
            key={`try-wizard-${wizardVersion}`}
            lock={lock}
            onDirtyChange={setDraftDirty}
            onFunnelEvent={handleWizardEvent}
            variant="campaign"
          />
        </div>
      </section>

      <TryHowItWorks drops={drops} />
      <TryGallery drops={drops} onRemix={handleRemix} />
      <TryFinalCta
        disabled={!draftRestored}
        error={promptError?.source === 'closing' ? promptError.message : null}
        inputRef={closingInputRef}
        onChange={handlePromptChange}
        onSubmit={() => submitTopic('closing')}
        value={promptValue}
      />
    </div>
  );
}
