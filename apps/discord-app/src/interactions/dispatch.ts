// Implements: ADR-0041
import {
  DiscordInteractionType,
  DiscordResponseType,
  type CommandDispatcher,
  type DiscordInteraction,
  type DiscordInteractionResponse,
  type RecordDiscordCommandOutcome,
} from './types';

export async function dispatchInteraction(
  interaction: DiscordInteraction,
  commandDispatcher?: CommandDispatcher,
  recordOutcome?: RecordDiscordCommandOutcome
): Promise<DiscordInteractionResponse> {
  if (interaction.type === DiscordInteractionType.Ping) {
    return { type: DiscordResponseType.Pong };
  }

  if (interaction.type === DiscordInteractionType.ApplicationCommand && commandDispatcher) {
    return commandDispatcher(interaction, recordOutcome);
  }

  throw new Error('Unsupported interaction');
}
