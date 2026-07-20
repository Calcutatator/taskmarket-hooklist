import type React from 'react';
import { TaskCreateSchema } from '@taskmarket/shared';
import { parseUnits } from 'viem';

export type CreateTaskFormValues = {
  auctionFloorPrice: string;
  auctionStartPrice: string;
  auctionType: string;
  bidDeadline: string;
  description: string;
  duration: string;
  maxPrice: string;
  metricDescription: string;
  metricTarget: string;
  mode: string;
  pitchDeadline: string;
  reward: string;
  stakeBps: string;
  stakeRequired: boolean;
  tags: string;
  visibility: 'public' | 'unlisted';
  hookContract: string;
  evaluator: string;
  evaluatorFeeBps: string;
  evaluationWindow: string;
  appealWindow: string;
  disputeResolver: string;
  taskDropMode: 'none' | 'existing' | 'new';
  taskDropId: string;
  taskDropName: string;
  taskDropDescription: string;
};

export type CreateTaskFieldErrors = Partial<Record<keyof CreateTaskFormValues, string>>;

// Default values for a fresh create-task form. Seeds react-hook-form and keeps
// non-claim payloads computing 0 basis points exactly as the legacy form did.
export const DEFAULT_FORM_VALUES: CreateTaskFormValues = {
  auctionFloorPrice: '',
  auctionStartPrice: '',
  auctionType: 'english',
  bidDeadline: '',
  description: '',
  duration: '72',
  maxPrice: '',
  metricDescription: '',
  metricTarget: '',
  mode: 'bounty',
  pitchDeadline: '',
  reward: '',
  stakeBps: '0',
  stakeRequired: false,
  tags: '',
  visibility: 'public',
  hookContract: '',
  evaluator: '',
  evaluatorFeeBps: '',
  evaluationWindow: '',
  appealWindow: '',
  disputeResolver: '',
  taskDropMode: 'none',
  taskDropId: '',
  taskDropName: '',
  taskDropDescription: '',
};

// Maps schema/payload field names to the matching form field where they diverge.
export const PAYLOAD_FIELD_TO_FORM: Record<string, keyof CreateTaskFormValues> = {
  evaluationWindowHours: 'evaluationWindow',
  appealWindowHours: 'appealWindow',
};

// Upper bound for task duration so a typo cannot escrow funds for years.
export const MAX_DURATION_HOURS = 8_760;

// DOM order of focusable form fields, used to focus the first invalid one on submit.
export const FIELD_FOCUS_ORDER: (keyof CreateTaskFormValues)[] = [
  'description',
  'reward',
  'duration',
  'tags',
  'maxPrice',
  'auctionFloorPrice',
  'auctionStartPrice',
  'metricDescription',
  'metricTarget',
  'taskDropId',
  'taskDropName',
];

export function optionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined;
}

export function countTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean).length;
}

// WAI-ARIA radiogroup keyboard handler: arrows move selection and focus, the
// group is a single tab stop via roving tabindex on the buttons.
export function handleRadioGroupKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  values: string[],
  current: string,
  select: (value: string) => void
) {
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  if (!forward && !backward) {
    return;
  }

  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const delta = forward ? 1 : -1;
  const nextIndex = (currentIndex + delta + values.length) % values.length;
  const nextValue = values[nextIndex];
  select(nextValue);

  const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  buttons[nextIndex]?.focus();
}

export function optionalHoursToSeconds(value: string) {
  const hours = optionalNumber(value);
  return hours === undefined ? undefined : Math.round(hours * 3_600);
}

export function optionalUsdcBaseUnits(value: string) {
  return value.trim() ? parseUnits(value, 6).toString() : undefined;
}

export function percentToBps(value: string) {
  const percent = Number(value || 0);
  return Number.isFinite(percent) ? Math.round(percent * 100) : 0;
}

export function buildCreateTaskPayload(values: CreateTaskFormValues) {
  const payload: Record<string, unknown> = {
    description: values.description,
    duration: Number(values.duration),
    mode: values.mode,
    reward: parseUnits(values.reward, 6).toString(),
    visibility: values.visibility,
    stakeBps: percentToBps(values.stakeBps),
    stakeRequired: values.stakeRequired,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };

  const bidDeadline = optionalNumber(values.bidDeadline);
  const pitchDeadline = optionalHoursToSeconds(values.pitchDeadline);
  const maxPrice = optionalUsdcBaseUnits(values.maxPrice);
  const auctionStartPrice = optionalUsdcBaseUnits(values.auctionStartPrice);
  const auctionFloorPrice = optionalUsdcBaseUnits(values.auctionFloorPrice);

  if (bidDeadline !== undefined) payload.bidDeadline = bidDeadline;
  if (pitchDeadline !== undefined) payload.pitchDeadline = pitchDeadline;
  if (maxPrice) payload.maxPrice = maxPrice;
  if (values.metricDescription.trim()) payload.metricDescription = values.metricDescription;
  if (values.metricTarget.trim()) payload.metricTarget = values.metricTarget;
  if (values.mode === 'auction') {
    payload.auctionType = values.auctionType;
    if (auctionStartPrice) payload.auctionStartPrice = auctionStartPrice;
    if (auctionFloorPrice) payload.auctionFloorPrice = auctionFloorPrice;
  }

  if (values.hookContract.trim()) {
    payload.hookContract = values.hookContract.trim();
  }

  if (values.evaluator.trim()) {
    payload.evaluator = values.evaluator.trim();
    const evalFeeBps = percentToBps(values.evaluatorFeeBps);
    if (evalFeeBps > 0) payload.evaluatorFeeBps = evalFeeBps;
    const evalWindowHours = optionalNumber(values.evaluationWindow);
    if (evalWindowHours !== undefined) payload.evaluationWindowHours = evalWindowHours;
    const appealWindowHours = optionalNumber(values.appealWindow);
    if (appealWindowHours !== undefined) payload.appealWindowHours = appealWindowHours;
    if (values.disputeResolver.trim()) payload.disputeResolver = values.disputeResolver.trim();
  }

  if (values.taskDropMode === 'existing' && values.taskDropId.trim()) {
    payload.taskDropId = values.taskDropId.trim();
  }

  if (values.taskDropMode === 'new' && values.taskDropName.trim()) {
    payload.taskDropCreate = {
      name: values.taskDropName.trim(),
      description: values.taskDropDescription.trim() || undefined,
    };
  }

  return payload;
}

export function validateCreateTask(
  values: CreateTaskFormValues,
  fields?: Array<keyof CreateTaskFormValues>
): CreateTaskFieldErrors | null {
  const errors: CreateTaskFieldErrors = {};
  const body = buildCreateTaskPayload(values);
  const parsed = TaskCreateSchema.safeParse(body);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const payloadField = String(issue.path[0] ?? '');
      const field = (PAYLOAD_FIELD_TO_FORM[payloadField] ??
        payloadField) as keyof CreateTaskFormValues;
      if (field && !errors[field]) {
        errors[field] = issue.message;
      }
    }
  }

  const duration = Number(values.duration);
  if (Number.isFinite(duration) && duration > MAX_DURATION_HOURS) {
    errors.duration = `Duration must be ${MAX_DURATION_HOURS} hours or fewer.`;
  }

  if (values.mode === 'auction') {
    const maxPrice = optionalNumber(values.maxPrice);
    if (values.auctionType === 'dutch') {
      const floor = optionalNumber(values.auctionFloorPrice);
      if (maxPrice !== undefined && floor !== undefined && floor >= maxPrice) {
        errors.auctionFloorPrice = 'Floor price must be below the max price.';
      }
    }
    if (values.auctionType === 'reverse_dutch') {
      const start = optionalNumber(values.auctionStartPrice);
      if (maxPrice !== undefined && start !== undefined && start >= maxPrice) {
        errors.auctionStartPrice = 'Start price must be below the max price.';
      }
    }
  }

  if (values.taskDropMode === 'existing' && !values.taskDropId.trim()) {
    errors.taskDropId = 'Choose a drop or switch to no drop.';
  }

  if (values.taskDropMode === 'new' && !values.taskDropName.trim()) {
    errors.taskDropName = 'Drop name is required.';
  }

  if (fields) {
    const scoped: CreateTaskFieldErrors = {};
    for (const field of fields) {
      if (errors[field]) {
        scoped[field] = errors[field];
      }
    }
    return Object.keys(scoped).length > 0 ? scoped : null;
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
