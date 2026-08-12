import { describe, expect, it } from 'vitest';

import { DEFAULT_FORM_VALUES } from './create-task-form';
import { blankValuesForMode, transitionTemplateChoice } from './task-template-transition';
import { templatesForMode } from './task-templates';

describe('blankValuesForMode', () => {
  it('clears stale mode-specific values when changing work type', () => {
    expect(blankValuesForMode('claim')).toMatchObject({
      auctionType: 'english',
      bidDeadline: '',
      metricDescription: '',
      mode: 'claim',
      pitchDeadline: '',
      reward: '',
      stakeBps: '0',
      stakeRequired: false,
    });
  });
});

describe('transitionTemplateChoice', () => {
  it('applies template defaults while preserving requester-wide choices', () => {
    const current = {
      ...DEFAULT_FORM_VALUES,
      accessPassword: 'memory-only-secret',
      description: 'Old brief',
      evaluator: '0x1111111111111111111111111111111111111111',
      reward: '50',
      taskDropId: 'drop-1',
      taskDropMode: 'existing' as const,
      taskVisibility: 'unlisted' as const,
    };

    const result = transitionTemplateChoice({
      current,
      mode: 'benchmark',
      templateId: 'api-latency',
    });

    expect(result.values).toMatchObject({
      evaluator: current.evaluator,
      accessPassword: 'memory-only-secret',
      metricDescription:
        'p95 response latency in whole microseconds under the pinned load profile; lower is better.',
      mode: 'benchmark',
      reward: '',
      taskDropId: 'drop-1',
      taskDropMode: 'existing',
      taskVisibility: 'unlisted',
    });
    expect(result.values.description).toContain(
      'Reduce p95 latency for [Add: Endpoint or operation]'
    );
    expect(result.values.description).toContain('\n\nOutcome\nReduce p95 response latency');
    expect(result.briefState.readinessValues).toEqual({});
    expect(result.briefState.readinessConfirmations).toEqual({});
    expect(result.briefState.tokenValues).toEqual({});
  });

  it('rejects an authored template id that does not match the mode', () => {
    expect(() =>
      transitionTemplateChoice({
        current: { ...DEFAULT_FORM_VALUES, reward: '25' },
        mode: 'claim',
        templateId: 'logo',
      })
    ).toThrow('Template logo does not belong to claim mode.');
  });

  it('keeps the locked campaign reward overlay', () => {
    const result = transitionTemplateChoice({
      current: DEFAULT_FORM_VALUES,
      lock: { prefillFirstToken: 'Agent workflows', reward: '2', templateId: 'infographic' },
      mode: 'bounty',
      templateId: 'infographic',
    });

    expect(result.values.reward).toBe('2');
    expect(result.values.description).toContain('Agent workflows');
    expect(result.briefState.readinessValues).toEqual({});
    expect(result.briefState.readinessConfirmations).toEqual({});
    expect(result.briefState.tokenValues).toEqual({ topic: 'Agent workflows' });
  });

  it('clears source-mode and financial state for every cross-mode destination choice', () => {
    const modes = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'] as const;

    for (const sourceMode of modes) {
      for (const destinationMode of modes) {
        if (sourceMode === destinationMode) continue;
        const choices = [null, ...templatesForMode(destinationMode).map((template) => template.id)];

        for (const templateId of choices) {
          const result = transitionTemplateChoice({
            current: {
              ...DEFAULT_FORM_VALUES,
              accessPassword: 'memory-only-secret',
              auctionFloorPrice: '10',
              auctionStartPrice: '15',
              bidDeadline: '24',
              maxPrice: '50',
              metricDescription: 'Old metric',
              metricTarget: 'Old target',
              mode: sourceMode,
              pitchDeadline: '24',
              reward: '50',
              stakeBps: '500',
              stakeRequired: true,
            },
            mode: destinationMode,
            templateId,
          });

          expect(result.values.accessPassword).toBe('memory-only-secret');
          expect(result.values.reward).toBe('');
          expect(result.values.maxPrice).toBe('');
          expect(result.values.auctionFloorPrice).toBe('');
          expect(result.values.auctionStartPrice).toBe('');
          if (destinationMode !== 'pitch') expect(result.values.pitchDeadline).toBe('');
          if (destinationMode !== 'benchmark') {
            expect(result.values.metricDescription).toBe('');
            expect(result.values.metricTarget).toBe('');
          }
          if (destinationMode !== 'auction') expect(result.values.bidDeadline).toBe('');
          if (destinationMode !== 'claim') {
            expect(result.values.stakeBps).toBe('0');
            expect(result.values.stakeRequired).toBe(false);
          }
        }
      }
    }
  });
});
