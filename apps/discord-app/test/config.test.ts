import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('Discord app configuration', () => {
  it('requires deployment-specific security and upstream values', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('uses the Railway commit and parses the guild allowlist', () => {
    const config = loadConfig({
      DEPLOY_ENVIRONMENT: 'DEVNET',
      DISCORD_ALLOWED_CHANNEL_IDS: '333, 444',
      DISCORD_ALLOWED_GUILD_IDS: '111, 222',
      DISCORD_PUBLIC_KEY: 'ab'.repeat(32),
      DISCORD_SUPPORT_URL: 'https://support.example.com/private',
      DISCORD_TASKMARKET_API_URL: 'https://api.example.com',
      RAILWAY_GIT_COMMIT_SHA: 'commit-123',
    });

    expect(config.commitSha).toBe('commit-123');
    expect(config.allowedChannelIds).toEqual(new Set(['333', '444']));
    expect(config.allowedGuildIds).toEqual(new Set(['111', '222']));
  });

  it('rejects malformed Discord snowflake allowlists', () => {
    expect(() =>
      loadConfig({
        DEPLOY_ENVIRONMENT: 'DEVNET',
        DISCORD_ALLOWED_CHANNEL_IDS: '333, not-a-snowflake',
        DISCORD_ALLOWED_GUILD_IDS: '111',
        DISCORD_PUBLIC_KEY: 'ab'.repeat(32),
        DISCORD_SUPPORT_URL: 'https://support.example.com/private',
        DISCORD_TASKMARKET_API_URL: 'https://api.example.com',
      })
    ).toThrow();
  });

  it('rejects non-HTTPS canonical links outside local development', () => {
    expect(() =>
      loadConfig({
        DEPLOY_ENVIRONMENT: 'PRODUCTION',
        DISCORD_ALLOWED_CHANNEL_IDS: '333',
        DISCORD_ALLOWED_GUILD_IDS: '111',
        DISCORD_PUBLIC_KEY: 'ab'.repeat(32),
        DISCORD_SUPPORT_URL: 'javascript:alert(1)',
        DISCORD_TASKMARKET_API_URL: 'https://api.example.com',
      })
    ).toThrow();
  });
});
