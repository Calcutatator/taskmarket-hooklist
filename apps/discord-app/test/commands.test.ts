// Verifies: ADR-0041
import { describe, expect, it, vi } from 'vitest';
import type { DiscordInteraction } from '../src/interactions/types';
import { createCommandDispatcher } from '../src/commands/dispatcher';
import { TaskmarketClient } from '../src/services/taskmarket-client';

function command(name: string, optionName?: string, value?: string): DiscordInteraction {
  return {
    id: `interaction-${name}`,
    type: 2,
    data: {
      name,
      options: optionName ? [{ name: optionName, type: 3, value }] : [],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('read-only Discord commands', () => {
  it('lists the ten highest-paying open tasks in a compact linked summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hasMore: false,
        nextCursor: null,
        tasks: [
          {
            description: 'Highest paying task',
            expiryTime: '2026-08-07T00:00:00.000Z',
            id: 'task-high',
            mode: 'bounty',
            reward: '25000000',
            status: 'open',
            tags: ['typescript'],
            taskVisibility: 'public',
          },
          {
            description: 'Second task',
            expiryTime: '2026-08-08T00:00:00.000Z',
            id: 'task-second',
            mode: 'benchmark',
            reward: '5000000',
            status: 'open',
            tags: [],
            taskVisibility: 'public',
          },
        ],
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher(command('tasks'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.taskmarket.dev/api/tasks?status=open&sort=reward_desc&limit=10',
      expect.objectContaining({ method: 'GET' })
    );
    expect(response).toMatchObject({
      data: {
        allowed_mentions: { parse: [] },
        embeds: [
          {
            description:
              '**1. Highest paying task**\n$25.00 USDC · Bounty · [View task](https://taskmarket.dev/tasks/task-high)\n**2. Second task**\n$5.00 USDC · Benchmark · [View task](https://taskmarket.dev/tasks/task-second)\n\n[View all open tasks](https://taskmarket.dev/tasks?status=open&sort=reward_desc)',
            title: 'Top open tasks by reward',
            url: 'https://taskmarket.dev/tasks?status=open&sort=reward_desc',
          },
        ],
      },
      type: 4,
    });
    expect(response.data?.embeds?.[0]?.fields).toBeUndefined();
  });

  it('shortens long list titles with an ellipsis', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hasMore: false,
        nextCursor: null,
        tasks: [
          {
            description: 'x'.repeat(120),
            expiryTime: '2026-08-07T00:00:00.000Z',
            id: 'task-long-title',
            mode: 'bounty',
            reward: '5000000',
            status: 'open',
            tags: [],
            taskVisibility: 'public',
          },
        ],
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher(command('tasks'));
    const description = response.data?.embeds?.[0]?.description;
    const title = description?.split('\n', 1)[0]?.replaceAll('*', '');

    expect(title?.length).toBeLessThanOrEqual(76);
    expect(title).toMatch(/^1\. x+…$/);
  });

  it('keeps a full task list inside Discord description limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hasMore: false,
        nextCursor: null,
        tasks: Array.from({ length: 10 }, (_, index) => ({
          description: '*'.repeat(120),
          expiryTime: '2026-08-07T00:00:00.000Z',
          id: `${')'.repeat(126)}-${index}`,
          mode: '*'.repeat(128),
          reward: '9'.repeat(78),
          status: 'open',
          tags: [],
          taskVisibility: 'public',
        })),
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher(command('tasks'));
    const description = response.data?.embeds?.[0]?.description ?? '';

    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description).toContain('[View all open tasks]');
  });

  it('lists only Task Drops that currently have open work', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            availableTaskCount: 2,
            drop: { id: 'launch-week', name: 'Launch week\nInjected second line' },
            totalReward: '600000000',
          },
          {
            availableTaskCount: 0,
            drop: { id: 'resolved-drop', name: 'Resolved Drop' },
            totalReward: '100000000',
          },
        ],
        nextCursor: null,
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher(command('task-drops'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.taskmarket.dev/api/task-drops/directory?limit=10',
      expect.objectContaining({ method: 'GET' })
    );
    expect(response).toMatchObject({
      data: {
        allowed_mentions: { parse: [] },
        embeds: [
          {
            description:
              '**1. Launch week** — 2 open tasks · [View drop](https://taskmarket.dev/drops/launch-week)\n\n[View all Task Drops](https://taskmarket.dev/dashboard/drops)',
            title: 'Open Task Drops',
            url: 'https://taskmarket.dev/dashboard/drops',
          },
        ],
      },
      type: 4,
    });
    expect(response.data?.embeds?.[0]?.fields).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain('Resolved Drop');
  });

  it('renders an explicitly public task from the fixed Taskmarket route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        description: 'Build a safe parser\nwith tests',
        expiryTime: '2026-08-07T00:00:00.000Z',
        id: 'task-123',
        mode: 'bounty',
        reward: '5000000',
        status: 'open',
        tags: ['typescript'],
        taskVisibility: 'public',
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher(command('task', 'task_id', 'task-123'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.taskmarket.dev/api/tasks/task-123',
      expect.objectContaining({ method: 'GET' })
    );
    expect(response).toMatchObject({
      data: {
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: 'Build a safe parser',
            url: 'https://taskmarket.dev/tasks/task-123',
          },
        ],
      },
      type: 4,
    });
    expect(response.data?.embeds?.[0]?.fields).toContainEqual({
      inline: true,
      name: 'Reward',
      value: '$5.00 USDC',
    });
  });

  it('gives the same private response for unlisted, private, and missing tasks', async () => {
    const unlistedFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        description: 'Do not broadcast this description',
        expiryTime: '2026-08-07T00:00:00.000Z',
        id: 'secret-task',
        mode: 'bounty',
        reward: '5000000',
        status: 'open',
        tags: [],
        taskVisibility: 'unlisted',
      })
    );
    const missingFetch = vi.fn().mockResolvedValue(jsonResponse(null));
    const privateFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        description: 'Private task description',
        expiryTime: '2026-08-07T00:00:00.000Z',
        id: 'private-task',
        mode: 'bounty',
        reward: '5000000',
        status: 'open',
        tags: [],
        taskVisibility: 'private',
      })
    );
    const dependencies = {
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      webUrl: 'https://taskmarket.dev',
    };

    const unlistedResponse = await createCommandDispatcher({
      ...dependencies,
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', unlistedFetch),
    })(command('task', 'task_id', 'secret-task'));
    const missingResponse = await createCommandDispatcher({
      ...dependencies,
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', missingFetch),
    })(command('task', 'task_id', 'private-task'));
    const privateResponse = await createCommandDispatcher({
      ...dependencies,
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', privateFetch),
    })(command('task', 'task_id', 'private-task'));

    expect(unlistedResponse).toEqual(missingResponse);
    expect(privateResponse).toEqual(missingResponse);
    expect(JSON.stringify(unlistedResponse)).not.toContain('Do not broadcast');
    expect(JSON.stringify(privateResponse)).not.toContain('Private task description');
  });

  it('renders a public Task Drop and routes guidance commands to canonical links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drop: {
          announcedAt: null,
          createdAt: '2026-08-05T00:00:00.000Z',
          description: 'Public TypeScript work',
          id: 'drop-1',
          isOfficial: false,
          name: 'TypeScript Builders',
          officialWalletAddress: '0x1111111111111111111111111111111111111111',
          ownerAddress: '0x1111111111111111111111111111111111111111',
        },
        tasks: [
          {
            createdAt: '2026-08-05T00:00:00.000Z',
            description: 'Build public tooling',
            expiryTime: '2026-08-07T00:00:00.000Z',
            id: 'task-1',
            mode: 'bounty',
            reward: '5000000',
            status: 'open',
            tags: [],
          },
        ],
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const dropResponse = await dispatcher(command('drop', 'drop_id', 'drop-1'));
    const docsResponse = await dispatcher(command('docs'));
    const reportResponse = await dispatcher(command('report'));

    expect(dropResponse.data?.embeds?.[0]).toMatchObject({
      title: 'TypeScript Builders',
      url: 'https://taskmarket.dev/drops/drop-1',
    });
    expect(docsResponse.data?.content).toContain('https://docs.taskmarket.dev');
    expect(reportResponse.data?.content).toContain('https://taskmarket.dev/support');
  });

  it('does not publish metadata for a Task Drop without discoverable tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        drop: {
          description: 'Not yet published',
          id: 'draft-drop',
          name: 'Draft Drop',
        },
        tasks: [],
      })
    );
    const dispatcher = createCommandDispatcher({
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher(command('drop', 'drop_id', 'draft-drop'));

    expect(response).toEqual({
      data: {
        allowed_mentions: { parse: [] },
        content: 'That item is unavailable or is not public.',
        flags: 64,
      },
      type: 4,
    });
    expect(JSON.stringify(response)).not.toContain('Not yet published');
  });

  it('rejects commands from guilds outside the configured allowlist', async () => {
    const fetchMock = vi.fn();
    const dispatcher = createCommandDispatcher({
      allowedGuildIds: new Set(['official-guild']),
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher({
      ...command('task', 'task_id', 'task-123'),
      guild_id: 'other',
    });

    expect(response.data?.content).toContain('not enabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects commands outside the configured channel allowlist', async () => {
    const fetchMock = vi.fn();
    const dispatcher = createCommandDispatcher({
      allowedChannelIds: new Set(['approved-channel']),
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher({
      ...command('task', 'task_id', 'task-123'),
      channel_id: 'other-channel',
    });

    expect(response.data?.content).toContain('not enabled in this channel');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows commands inside a thread whose parent forum is approved', async () => {
    const fetchMock = vi.fn();
    const dispatcher = createCommandDispatcher({
      allowedChannelIds: new Set(['approved-forum']),
      docsUrl: 'https://docs.taskmarket.dev',
      supportUrl: 'https://taskmarket.dev/support',
      taskmarket: new TaskmarketClient('https://api.taskmarket.dev', fetchMock),
      webUrl: 'https://taskmarket.dev',
    });

    const response = await dispatcher({
      ...command('docs'),
      channel: { id: 'forum-thread', parent_id: 'approved-forum' },
      channel_id: 'forum-thread',
    } as DiscordInteraction);

    expect(response.data?.content).toContain('https://docs.taskmarket.dev');
  });
});
