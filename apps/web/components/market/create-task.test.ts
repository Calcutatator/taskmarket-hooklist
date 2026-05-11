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
        pitchDeadline: '',
        reward: '25.75',
        stakeBps: '0',
        stakeRequired: false,
        tags: 'scrape, data',
      })
    ).toEqual({
      auctionFloorPrice: '4250000',
      auctionType: 'dutch',
      bidDeadline: 24,
      description: 'Build a scraper',
      duration: 72,
      maxPrice: '12500000',
      mode: 'auction',
      reward: '25750000',
      stakeBps: 0,
      stakeRequired: false,
      tags: ['scrape', 'data'],
    });
  });
});
