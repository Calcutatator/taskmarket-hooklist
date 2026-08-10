import { isCommandName, type CommandName } from '../commands/manifest';
import type { DiscordCommandOutcome } from '../interactions/types';

export interface DiscordOperationalEvent {
  command?: CommandName | 'unknown';
  durationMs: number;
  event: 'discord_interaction';
  outcome: DiscordCommandOutcome | 'invalid_signature';
}

export type RecordOperationalEvent = (event: DiscordOperationalEvent) => void;

export function writeOperationalEvent(event: DiscordOperationalEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export function safeCommandName(name: string | undefined): DiscordOperationalEvent['command'] {
  if (name && isCommandName(name)) return name;
  return name ? 'unknown' : undefined;
}
