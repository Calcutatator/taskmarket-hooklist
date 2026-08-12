import type { TaskModeType } from '@taskmarket/shared';

import { DEFAULT_FORM_VALUES, type CreateTaskFormValues } from './create-task-form';
import {
  composeBrief,
  findTemplate,
  templateBelongsToMode,
  type TaskTemplateId,
  type TaskTemplateSelection,
} from './task-templates';

export type TemplateBriefState = {
  hasManualEdits: boolean;
  presetId?: string;
  readinessConfirmations: Record<string, boolean>;
  readinessValues: Record<string, string>;
  tokenValues: Record<string, string>;
};

export type TemplateLock = {
  prefillFirstToken?: string;
  reward: string;
  templateId: TaskTemplateId;
};

const PRESERVED_FIELDS = [
  'accessPassword',
  'allowedViewers',
  'appealWindow',
  'disputeResolver',
  'evaluationWindow',
  'evaluator',
  'evaluatorFeeBps',
  'hookContract',
  'submissionVisibility',
  'taskDropDescription',
  'taskDropId',
  'taskDropMode',
  'taskDropName',
  'taskVisibility',
] as const satisfies ReadonlyArray<keyof CreateTaskFormValues>;

export function blankValuesForMode(mode: TaskModeType): CreateTaskFormValues {
  return { ...DEFAULT_FORM_VALUES, mode };
}

export function transitionTemplateChoice({
  current,
  lock,
  mode,
  templateId,
}: {
  current: CreateTaskFormValues;
  lock?: TemplateLock;
  mode: TaskModeType;
  templateId: TaskTemplateSelection | string;
}): {
  briefState: TemplateBriefState;
  templateId: TaskTemplateSelection;
  values: CreateTaskFormValues;
} {
  const preserved = Object.fromEntries(PRESERVED_FIELDS.map((field) => [field, current[field]]));
  const values: CreateTaskFormValues = { ...blankValuesForMode(mode), ...preserved };
  if (templateId !== null && !templateBelongsToMode(templateId, mode)) {
    throw new Error(`Template ${templateId} does not belong to ${mode} mode.`);
  }
  const validTemplateId = templateId;
  const template = findTemplate(validTemplateId);
  const readinessValues: Record<string, string> = {};
  const readinessConfirmations: Record<string, boolean> = {};
  const tokenValues: Record<string, string> = {};

  if (!template) {
    return {
      briefState: { hasManualEdits: false, readinessConfirmations, readinessValues, tokenValues },
      templateId: null,
      values,
    };
  }

  if (lock?.templateId === template.id && lock.prefillFirstToken && template.tokens[0]) {
    tokenValues[template.tokens[0].key] = lock.prefillFirstToken;
  }

  values.description = composeBrief(template, tokenValues, readinessValues);
  values.duration = String(template.durationHours);
  values.tags = template.tags.join(', ');
  values.reward = lock?.templateId === template.id ? lock.reward : '';

  switch (template.mode) {
    case 'claim':
      values.stakeBps = template.modeDefaults.stakeBps;
      values.stakeRequired = template.modeDefaults.stakeRequired;
      break;
    case 'pitch':
      values.pitchDeadline = template.modeDefaults.pitchDeadline;
      break;
    case 'benchmark':
      values.metricDescription = template.modeDefaults.metricDescription;
      values.metricTarget = template.modeDefaults.metricTarget;
      break;
    case 'auction':
      values.auctionType = template.modeDefaults.auctionType;
      values.bidDeadline = template.modeDefaults.bidDeadline;
      break;
    case 'bounty':
      break;
  }

  return {
    briefState: { hasManualEdits: false, readinessConfirmations, readinessValues, tokenValues },
    templateId: validTemplateId,
    values,
  };
}
