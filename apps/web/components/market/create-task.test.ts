import { describe, expect, it } from 'vitest';
import {
  buildCreateTaskPayload,
  validateCreateTask,
  type CreateTaskFormValues,
} from '@/lib/market/create-task-form';

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
        taskVisibility: 'public',
        submissionVisibility: 'public',
        allowedViewers: '',
        accessPassword: '',
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
      })
    ).toEqual({
      auctionFloorPrice: '4250000',
      auctionType: 'dutch',
      bidDeadline: 24,
      description: 'Build a scraper',
      duration: 72,
      maxPrice: '25750000',
      mode: 'auction',
      pitchDeadline: 86400,
      reward: '25750000',
      stakeBps: 1250,
      stakeRequired: true,
      tags: ['scrape', 'data'],
      taskVisibility: 'public',
      submissionVisibility: 'public',
    });
  });
});

function validValues(): CreateTaskFormValues {
  return {
    auctionFloorPrice: '',
    auctionStartPrice: '',
    auctionType: 'english',
    bidDeadline: '',
    description: 'Build a scraper',
    duration: '72',
    maxPrice: '',
    metricDescription: '',
    metricTarget: '',
    mode: 'bounty',
    pitchDeadline: '',
    reward: '25.75',
    stakeBps: '0',
    stakeRequired: false,
    tags: 'scrape, data',
    taskVisibility: 'public',
    submissionVisibility: 'public',
    allowedViewers: '',
    accessPassword: '',
    hookContract: '',
    evaluator: '',
    evaluatorFeeBps: '',
    evaluationWindow: '',
    appealWindow: '',
    disputeResolver: '',
    taskDropMode: 'none' as const,
    taskDropId: '',
    taskDropName: '',
    taskDropDescription: '',
  };
}

describe('validateCreateTask', () => {
  it('returns no errors for valid input', () => {
    const errors = validateCreateTask(validValues());
    expect(errors).toBeNull();
  });

  it('flags an over-length description', () => {
    const errors = validateCreateTask({ ...validValues(), description: 'x'.repeat(10001) });
    expect(errors?.description).toBeTruthy();
  });

  it('flags more than 10 tags', () => {
    const tags = Array.from({ length: 11 }, (_, index) => `tag${index}`).join(', ');
    const errors = validateCreateTask({ ...validValues(), tags });
    expect(errors?.tags).toBeTruthy();
  });

  it('flags a dutch auction floor price at or above the max price', () => {
    const errors = validateCreateTask({
      ...validValues(),
      mode: 'auction',
      auctionType: 'dutch',
      reward: '10',
      auctionFloorPrice: '10',
    });
    expect(errors?.auctionFloorPrice).toBeTruthy();
  });

  it('flags a reverse_dutch auction start price at or above the max price', () => {
    const errors = validateCreateTask({
      ...validValues(),
      mode: 'auction',
      auctionType: 'reverse_dutch',
      reward: '10',
      auctionStartPrice: '12',
    });
    expect(errors?.auctionStartPrice).toBeTruthy();
  });

  it('flags a duration above the upper bound', () => {
    const errors = validateCreateTask({ ...validValues(), duration: '100000' });
    expect(errors?.duration).toBeTruthy();
  });
});
