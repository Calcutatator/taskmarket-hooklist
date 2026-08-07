export const DiscordInteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
} as const;

export const DiscordResponseType = {
  Pong: 1,
  ChannelMessage: 4,
} as const;

export const DiscordMessageFlag = {
  Ephemeral: 64,
} as const;

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface DiscordInteraction {
  id: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  channel?: {
    id: string;
    parent_id?: string | null;
  };
  data?: {
    name: string;
    options?: DiscordCommandOption[];
  };
}

export interface DiscordMessageData {
  allowed_mentions: { parse: string[] };
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>;
  flags?: number;
}

export interface DiscordInteractionResponse {
  type: number;
  data?: DiscordMessageData;
}

export type DiscordCommandOutcome = 'denied' | 'ok' | 'rejected' | 'upstream_unavailable';
export type RecordDiscordCommandOutcome = (outcome: DiscordCommandOutcome) => void;

export type CommandDispatcher = (
  interaction: DiscordInteraction,
  recordOutcome?: RecordDiscordCommandOutcome
) => Promise<DiscordInteractionResponse>;
