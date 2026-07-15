import { describe, expect, it } from 'vitest';

import {
  TaskDropAnnouncementInputSchema,
  TaskDropAnnouncementResponseSchema,
  TaskDropOfficialStatusInputSchema,
  TaskDropOfficialSubscribeInputSchema,
  TaskDropListByOwnerInputSchema,
  TaskDropPageDataSchema,
  TaskDropStatusInputSchema,
  TaskDropSubscribeInputSchema,
} from '../../src/schemas/task-drops.schemas';
import { TaskCreateSchema } from '../../src/schemas/task.schemas';

describe('Task Drops schemas', () => {
  it('normalizes subscriber email and defaults the source to the drop page', () => {
    const parsed = TaskDropSubscribeInputSchema.parse({
      taskDropId: 'drop-1',
      email: '  ALICE@Example.COM  ',
    });

    expect(parsed.taskDropId).toBe('drop-1');
    expect(parsed.email).toBe('alice@example.com');
    expect(parsed.source).toBe('drop_page');
  });

  it('accepts explicit subscription sources and wallet addresses', () => {
    const parsed = TaskDropSubscribeInputSchema.parse({
      taskDropId: 'drop-1',
      email: 'agent@example.com',
      source: 'agent_setup',
      walletAddress: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
    });

    expect(parsed.source).toBe('agent_setup');
    expect(parsed.walletAddress).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
  });

  it('normalizes official-list subscription and status inputs', () => {
    expect(
      TaskDropOfficialSubscribeInputSchema.parse({
        email: '  ALICE@Example.COM  ',
      })
    ).toEqual({ email: 'alice@example.com', source: 'taskdrop_landing' });

    expect(
      TaskDropOfficialSubscribeInputSchema.parse({
        email: 'agent@example.com',
        source: 'official_drop_page',
        walletAddress: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
      })
    ).toEqual({
      email: 'agent@example.com',
      source: 'official_drop_page',
      walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    });

    expect(TaskDropOfficialStatusInputSchema.parse({ email: ' BOB@Example.COM ' })).toEqual({
      email: 'bob@example.com',
    });
  });

  it('validates the official announcement contract', () => {
    expect(TaskDropAnnouncementInputSchema.parse({ taskDropId: 'drop-1' })).toEqual({
      taskDropId: 'drop-1',
    });

    expect(
      TaskDropAnnouncementResponseSchema.parse({
        alreadyAnnounced: false,
        announcedAt: '2026-07-15T00:00:00.000Z',
        failed: 1,
        pending: 0,
        sent: 9,
        taskDropId: 'drop-1',
        total: 10,
      })
    ).toMatchObject({ sent: 9, failed: 1, total: 10 });
  });

  it('rejects invalid email addresses and invalid wallet addresses', () => {
    expect(() =>
      TaskDropSubscribeInputSchema.parse({
        taskDropId: 'drop-1',
        email: 'not-an-email',
      })
    ).toThrow();

    expect(() =>
      TaskDropSubscribeInputSchema.parse({
        taskDropId: 'drop-1',
        email: 'alice@example.com',
        walletAddress: 'not-an-address',
      })
    ).toThrow();

    expect(() =>
      TaskDropSubscribeInputSchema.parse({
        email: 'alice@example.com',
      })
    ).toThrow();
  });

  it('requires scoped status lookup by drop and exact email', () => {
    expect(() => TaskDropStatusInputSchema.parse({})).toThrow();

    expect(
      TaskDropStatusInputSchema.parse({
        taskDropId: 'drop-1',
        email: '  BOB@Example.COM ',
      })
    ).toEqual({ taskDropId: 'drop-1', email: 'bob@example.com' });

    expect(() =>
      TaskDropStatusInputSchema.parse({
        email: 'bob@example.com',
      })
    ).toThrow();

    expect(() =>
      TaskDropStatusInputSchema.parse({
        taskDropId: 'drop-1',
        walletAddress: '0x1111111111111111111111111111111111111111',
      })
    ).toThrow();
  });

  it('rejects task creation payloads that provide both drop choices', () => {
    expect(() =>
      TaskCreateSchema.parse({
        description: 'Build a parser',
        duration: 72,
        reward: '1000000',
        tags: ['cli'],
        taskDropId: 'drop-1',
        taskDropCreate: { name: 'CLI drop' },
      })
    ).toThrow('Provide taskDropId or taskDropCreate, not both');
  });

  it('normalizes list-by-owner input and validates public drop page data', () => {
    expect(
      TaskDropListByOwnerInputSchema.parse({
        ownerAddress: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
      })
    ).toEqual({ ownerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' });

    expect(
      TaskDropPageDataSchema.parse({
        drop: {
          announcedAt: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          description: null,
          id: 'drop-1',
          isOfficial: true,
          name: 'Growth',
          officialWalletAddress: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
          ownerAddress: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
        },
        tasks: [
          {
            createdAt: '2026-07-01T00:00:00.000Z',
            description: 'Ship the onboarding flow',
            expiryTime: '2026-07-08T00:00:00.000Z',
            id: 'task-1',
            mode: 'bounty',
            reward: '1000000',
            status: 'open',
            tags: ['frontend'],
          },
        ],
      })
    ).toMatchObject({
      drop: {
        id: 'drop-1',
        isOfficial: true,
        name: 'Growth',
        officialWalletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      },
      tasks: [{ id: 'task-1', reward: '1000000' }],
    });
  });

  it('rejects Task Drop summaries with a mismatched official wallet address', () => {
    expect(() =>
      TaskDropPageDataSchema.parse({
        drop: {
          announcedAt: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          description: null,
          id: 'drop-1',
          isOfficial: false,
          name: 'Growth',
          officialWalletAddress: '0x2222222222222222222222222222222222222222',
          ownerAddress: '0x1111111111111111111111111111111111111111',
        },
        tasks: [],
      })
    ).toThrow('officialWalletAddress must match ownerAddress');
  });
});
