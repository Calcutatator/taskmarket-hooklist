// Implements: ADR-0041
import type {
  CommandDispatcher,
  DiscordCommandOutcome,
  DiscordInteraction,
  DiscordInteractionResponse,
  RecordDiscordCommandOutcome,
} from '../interactions/types';
import {
  boundedListDescription,
  escapeMarkdown,
  firstLine,
  formatReward,
  message,
  safeText,
  truncateText,
} from '../presentation/discord';
import { TaskmarketClient } from '../services/taskmarket-client';

export interface CommandDependencies {
  allowedChannelIds?: ReadonlySet<string>;
  allowedGuildIds?: ReadonlySet<string>;
  docsUrl: string;
  statusUrl?: string;
  supportUrl: string;
  taskmarket: TaskmarketClient;
  webUrl: string;
}

const TASK_LIST_TITLE_LENGTH = 72;
const TASK_DROP_LIST_TITLE_LENGTH = 48;

const notPublic = () =>
  message(
    {
      content: 'That item is unavailable or is not public.',
    },
    true
  );

const temporarilyUnavailable = () =>
  message(
    {
      content: 'Taskmarket is temporarily unavailable. Please try again shortly.',
    },
    true
  );

function respond(
  response: DiscordInteractionResponse,
  outcome: DiscordCommandOutcome,
  recordOutcome?: RecordDiscordCommandOutcome
): DiscordInteractionResponse {
  recordOutcome?.(outcome);
  return response;
}

function option(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find((candidate) => candidate.name === name)?.value;
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;
}

export function createCommandDispatcher(dependencies: CommandDependencies): CommandDispatcher {
  return async (interaction, recordOutcome): Promise<DiscordInteractionResponse> => {
    if (
      dependencies.allowedGuildIds?.size &&
      (!interaction.guild_id || !dependencies.allowedGuildIds.has(interaction.guild_id))
    ) {
      return respond(
        message({ content: 'This Taskmarket app is not enabled for this server.' }, true),
        'denied',
        recordOutcome
      );
    }

    if (
      dependencies.allowedChannelIds?.size &&
      (!interaction.channel_id ||
        (!dependencies.allowedChannelIds.has(interaction.channel_id) &&
          (!interaction.channel?.parent_id ||
            !dependencies.allowedChannelIds.has(interaction.channel.parent_id))))
    ) {
      return respond(
        message({ content: 'This command is not enabled in this channel.' }, true),
        'denied',
        recordOutcome
      );
    }

    const commandName = interaction.data?.name;

    if (commandName === 'docs') {
      return respond(
        message({ content: `Taskmarket documentation: ${dependencies.docsUrl}` }, true),
        'ok',
        recordOutcome
      );
    }

    if (commandName === 'report') {
      return respond(
        message(
          {
            content: `Report bugs, scams, or safety concerns privately: ${dependencies.supportUrl}`,
          },
          true
        ),
        'ok',
        recordOutcome
      );
    }

    if (commandName === 'status' && dependencies.statusUrl) {
      return respond(
        message({ content: `Taskmarket service status: ${dependencies.statusUrl}` }, true),
        'ok',
        recordOutcome
      );
    }

    if (commandName === 'tasks') {
      try {
        const tasks = await dependencies.taskmarket.getOpenTasksByReward();
        if (tasks.length === 0) {
          return respond(
            message({ content: 'No open tasks are available right now.' }, true),
            'ok',
            recordOutcome
          );
        }

        const directoryUrl = `${dependencies.webUrl}/tasks?status=open&sort=reward_desc`;
        const entries = tasks.map((task, index) => {
          const title = escapeMarkdown(
            truncateText(firstLine(task.description, `Task ${task.id}`), TASK_LIST_TITLE_LENGTH)
          );
          const mode = escapeMarkdown(
            safeText(task.mode.charAt(0).toUpperCase() + task.mode.slice(1), 128)
          );
          const taskUrl = `${dependencies.webUrl}/tasks/${encodeURIComponent(task.id)}`;
          return `**${index + 1}. ${title}**\n${formatReward(task.reward)} · ${mode} · [View task](${taskUrl})`;
        });

        return respond(
          message({
            embeds: [
              {
                description: boundedListDescription(
                  entries,
                  `[View all open tasks](${directoryUrl})`
                ),
                title: 'Top open tasks by reward',
                url: directoryUrl,
              },
            ],
          }),
          'ok',
          recordOutcome
        );
      } catch {
        return respond(temporarilyUnavailable(), 'upstream_unavailable', recordOutcome);
      }
    }

    if (commandName === 'task-drops') {
      try {
        const taskDrops = await dependencies.taskmarket.getOpenTaskDrops();
        if (taskDrops.length === 0) {
          return respond(
            message({ content: 'No Task Drops have open work right now.' }, true),
            'ok',
            recordOutcome
          );
        }

        const directoryUrl = `${dependencies.webUrl}/dashboard/drops`;
        const entries = taskDrops.map((item, index) => {
          const title = escapeMarkdown(
            truncateText(
              firstLine(item.drop.name, 'Untitled Task Drop'),
              TASK_DROP_LIST_TITLE_LENGTH
            )
          );
          const taskCount = `${item.availableTaskCount} open ${item.availableTaskCount === 1 ? 'task' : 'tasks'}`;
          const dropUrl = `${dependencies.webUrl}/drops/${encodeURIComponent(item.drop.id)}`;
          return `**${index + 1}. ${title}** — ${taskCount} · [View drop](${dropUrl})`;
        });

        return respond(
          message({
            embeds: [
              {
                description: boundedListDescription(
                  entries,
                  `[View all Task Drops](${directoryUrl})`
                ),
                title: 'Open Task Drops',
                url: directoryUrl,
              },
            ],
          }),
          'ok',
          recordOutcome
        );
      } catch {
        return respond(temporarilyUnavailable(), 'upstream_unavailable', recordOutcome);
      }
    }

    if (commandName === 'task') {
      const taskId = option(interaction, 'task_id');
      if (!taskId) return respond(notPublic(), 'denied', recordOutcome);

      try {
        const task = await dependencies.taskmarket.getTask(taskId);
        if (!task) return respond(notPublic(), 'denied', recordOutcome);

        return respond(
          message({
            embeds: [
              {
                fields: [
                  { inline: true, name: 'Reward', value: formatReward(task.reward) },
                  { inline: true, name: 'Status', value: safeText(task.status, 128) },
                  { inline: true, name: 'Mode', value: safeText(task.mode, 128) },
                ],
                title: firstLine(task.description, `Task ${task.id}`),
                url: `${dependencies.webUrl}/tasks/${encodeURIComponent(task.id)}`,
              },
            ],
          }),
          'ok',
          recordOutcome
        );
      } catch {
        return respond(temporarilyUnavailable(), 'upstream_unavailable', recordOutcome);
      }
    }

    if (commandName === 'drop') {
      const dropId = option(interaction, 'drop_id');
      if (!dropId) return respond(notPublic(), 'denied', recordOutcome);

      try {
        const result = await dependencies.taskmarket.getDrop(dropId);
        if (!result) return respond(notPublic(), 'denied', recordOutcome);

        return respond(
          message({
            embeds: [
              {
                title: firstLine(result.drop.name, `Task Drop ${result.drop.id}`),
                url: `${dependencies.webUrl}/drops/${encodeURIComponent(result.drop.id)}`,
              },
            ],
          }),
          'ok',
          recordOutcome
        );
      } catch {
        return respond(temporarilyUnavailable(), 'upstream_unavailable', recordOutcome);
      }
    }

    return respond(
      message({ content: 'Unknown command. Use /docs for Taskmarket guidance.' }, true),
      'rejected',
      recordOutcome
    );
  };
}
