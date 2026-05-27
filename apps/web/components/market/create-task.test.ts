import { describe, expect, it } from 'vitest';
import { buildCreateTaskPayload } from './create-task-client';

describe('buildCreateTaskPayload', () => {
  it('converts human task form values into backend task create payload', () => {
    expect(
      buildCreateTaskPayload({
        auctionFloorPrice: '4.25',
        auctionStartPrice: '',
        auctionType: 'dutch',
        bidDeadline: '24',
        description: 'Build a scraper',
        duration: '72',
        maxPrice: '12.50',
        metricDescription: '',
        metricTarget: '',
        mode: 'auction',
        pitchDeadline: '24',
        reward: '25.75',
        stakeBps: '12.5',
        stakeRequired: true,
        tags: 'scrape, data',
        hookContract: '',
        evaluator: '',
        evaluatorFeeBps: '',
        evaluationWindow: '',
        appealWindow: '',
        disputeResolver: '',
      })
    ).toEqual({
      auctionFloorPrice: '4250000',
      auctionType: 'dutch',
      bidDeadline: 24,
      description: 'Build a scraper',
      duration: 72,
      maxPrice: '12500000',
      mode: 'auction',
      pitchDeadline: 86400,
      reward: '25750000',
      stakeBps: 1250,
      stakeRequired: true,
      tags: ['scrape', 'data'],
    });
  });
});
