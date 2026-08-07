import {
  DiscordMessageFlag,
  DiscordResponseType,
  type DiscordInteractionResponse,
  type DiscordMessageData,
} from '../interactions/types';

export function message(
  data: Omit<DiscordMessageData, 'allowed_mentions'>,
  ephemeral = false
): DiscordInteractionResponse {
  return {
    data: {
      ...data,
      allowed_mentions: { parse: [] },
      ...(ephemeral ? { flags: DiscordMessageFlag.Ephemeral } : {}),
    },
    type: DiscordResponseType.ChannelMessage,
  };
}

export function safeText(value: string, maxLength: number): string {
  return value.replaceAll('@', '@\u200b').replaceAll('`', '\u02cb').slice(0, maxLength);
}

export function firstLine(value: string, fallback: string, maxLength = 256): string {
  return safeText(value.split(/\r?\n/, 1)[0]?.trim() || fallback, maxLength);
}

export function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`;
}

export function escapeMarkdown(value: string): string {
  let escaped = value.replaceAll('<', '‹').replaceAll('>', '›').replaceAll('\\', '\\\\');
  for (const character of ['*', '_', '~', '|', '[', ']', '(', ')']) {
    escaped = escaped.replaceAll(character, `\\${character}`);
  }
  return escaped;
}

export function boundedListDescription(
  entries: readonly string[],
  footer: string,
  maxLength = 4_096
): string {
  if (footer.length > maxLength) return truncateText(footer, maxLength);

  const accepted: string[] = [];
  let length = footer.length + 2;
  for (const entry of entries) {
    const separatorLength = accepted.length > 0 ? 1 : 0;
    if (length + separatorLength + entry.length > maxLength) break;
    accepted.push(entry);
    length += separatorLength + entry.length;
  }

  return accepted.length > 0 ? `${accepted.join('\n')}\n\n${footer}` : footer;
}

export function formatReward(baseUnits: string): string {
  const amount = BigInt(baseUnits);
  const whole = amount / 1_000_000n;
  const cents = (amount % 1_000_000n) / 10_000n;
  return `$${new Intl.NumberFormat('en-US').format(whole)}.${cents
    .toString()
    .padStart(2, '0')} USDC`;
}
