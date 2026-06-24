import type { TaskResponse } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import { taskToAgentJson, taskToMarkdown } from './task-export';

// Minimal-but-complete TaskResponse fixture; override per test. reward is a base-unit
// string (6-decimal USDC) exactly as the API returns it.
function makeTask(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 'task-123',
    requester: '0x1111111111111111111111111111111111111111',
    requesterPubkey: '0xpub',
    description: 'Design a logo\nNeed a clean wordmark for our brand.',
    reward: '2500000',
    escrowTxHash: '0xtx',
    createdAt: '2026-06-01T00:00:00.000Z',
    expiryTime: '2026-06-30T00:00:00.000Z',
    status: 'open',
    tags: ['design', 'logo'],
    worker: null,
    rating: null,
    mode: 'bounty',
    stakeRequired: false,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: null,
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 250,
    submissionCount: 0,
    pitchCount: 0,
    submissionWindowOpen: true,
    ...overrides,
  };
}

describe('taskToAgentJson', () => {
  it('produces valid JSON that round-trips through JSON.parse', () => {
    const json = taskToAgentJson(makeTask());
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.id).toBe('task-123');
    expect(parsed.mode).toBe('bounty');
    expect(parsed.status).toBe('open');
  });

  it('passes the reward base-unit string through verbatim and adds a formatted value', () => {
    const parsed = JSON.parse(taskToAgentJson(makeTask({ reward: '2500000' }))) as Record<
      string,
      unknown
    >;
    expect(parsed.reward).toBe('2500000');
    expect(parsed.rewardFormatted).toBe('2.500 USDC');
  });

  it('is indented with two spaces', () => {
    const json = taskToAgentJson(makeTask());
    expect(json).toContain('\n  "id":');
  });

  it('produces stable output for the same input', () => {
    const task = makeTask();
    expect(taskToAgentJson(task)).toBe(taskToAgentJson(task));
  });

  it('uses a deterministic key order', () => {
    const parsed = JSON.parse(taskToAgentJson(makeTask())) as Record<string, unknown>;
    expect(Object.keys(parsed).slice(0, 9)).toEqual([
      'id',
      'description',
      'mode',
      'status',
      'reward',
      'rewardFormatted',
      'tags',
      'expiryTime',
      'requester',
    ]);
  });

  it('counts submissions from modeData when the counter is absent', () => {
    const parsed = JSON.parse(
      taskToAgentJson(makeTask({ submissionCount: undefined }), {
        submissions: [{}, {}, {}],
      })
    ) as { activity: { submissions: number } };
    expect(parsed.activity.submissions).toBe(3);
  });

  it('prefers the denormalised counter over modeData length', () => {
    const parsed = JSON.parse(
      taskToAgentJson(makeTask({ submissionCount: 5 }), { submissions: [{}] })
    ) as { activity: { submissions: number } };
    expect(parsed.activity.submissions).toBe(5);
  });

  it('reports pitch activity for pitch tasks', () => {
    const parsed = JSON.parse(taskToAgentJson(makeTask({ mode: 'pitch', pitchCount: 2 }))) as {
      activity: Record<string, number>;
    };
    expect(parsed.activity.pitches).toBe(2);
  });

  it('includes maxPrice for auction tasks', () => {
    const parsed = JSON.parse(
      taskToAgentJson(makeTask({ mode: 'auction', maxPrice: '5000000' }))
    ) as Record<string, unknown>;
    expect(parsed.maxPrice).toBe('5000000');
  });

  it('includes metric fields for benchmark tasks', () => {
    const parsed = JSON.parse(
      taskToAgentJson(
        makeTask({
          mode: 'benchmark',
          metricDescription: 'accuracy',
          metricTarget: '0.95',
        })
      )
    ) as Record<string, unknown>;
    expect(parsed.metricDescription).toBe('accuracy');
    expect(parsed.metricTarget).toBe('0.95');
  });

  it('includes stake fields only when stake is required', () => {
    const without = JSON.parse(taskToAgentJson(makeTask({ stakeRequired: false }))) as Record<
      string,
      unknown
    >;
    expect(without.stakeBps).toBeUndefined();

    const withStake = JSON.parse(
      taskToAgentJson(makeTask({ stakeRequired: true, stakeBps: 500 }))
    ) as Record<string, unknown>;
    expect(withStake.stakeRequired).toBe(true);
    expect(withStake.stakeBps).toBe(500);
  });
});

describe('taskToMarkdown', () => {
  it('contains the formatted reward', () => {
    const md = taskToMarkdown(makeTask({ reward: '2500000' }));
    expect(md).toContain('2.500 USDC');
  });

  it('contains the description body', () => {
    const md = taskToMarkdown(
      makeTask({ description: 'Build a CLI\nShip a typed command parser.' })
    );
    expect(md).toContain('Ship a typed command parser.');
  });

  it('uses the first line as the title heading', () => {
    const md = taskToMarkdown(makeTask({ description: 'Build a CLI\nDetails here.' }));
    expect(md).toContain('# Build a CLI');
  });

  it('lists mode, status, deadline, and tags as bullets', () => {
    const md = taskToMarkdown(
      makeTask({
        mode: 'pitch',
        status: 'open',
        expiryTime: '2026-06-30T00:00:00.000Z',
        tags: ['design', 'logo'],
      })
    );
    expect(md).toContain('- Mode: pitch');
    expect(md).toContain('- Status: open');
    expect(md).toContain('- Deadline: 2026-06-30T00:00:00.000Z');
    expect(md).toContain('- Tags: design, logo');
  });

  it('falls back to the full description when the brief is a single line', () => {
    const md = taskToMarkdown(makeTask({ description: 'One line only' }));
    expect(md).toContain('# One line only');
    expect(md).toContain('One line only');
  });

  it('renders "none" when there are no tags', () => {
    const md = taskToMarkdown(makeTask({ tags: [] }));
    expect(md).toContain('- Tags: none');
  });
});
