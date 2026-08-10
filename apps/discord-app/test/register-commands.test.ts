import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Discord command reconciliation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('can remove commands without depending on application health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('DISCORD_APPLICATION_ID', '123456789');
    vi.stubEnv('DISCORD_BOT_TOKEN', 'test-registration-token');
    vi.stubEnv('DISCORD_COMMAND_MODE', 'disabled');
    vi.stubEnv('DISCORD_GUILD_ID', '987654321');

    await import('../src/scripts/register-commands');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/123456789/guilds/987654321/commands',
      expect.objectContaining({ body: '[]', method: 'PUT' })
    );
  });
});
