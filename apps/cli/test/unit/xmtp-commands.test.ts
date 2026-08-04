import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi.fn(),
  saveKeystore: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../../src/lib/xmtp-client.js', () => ({
  createXmtpClient: vi.fn(),
  sendMessageEnvelope: vi.fn(),
  runQueryWithClient: vi.fn(),
  listenForEnvelopes: vi.fn(),
}));

import { xmtpCommand } from '../../src/commands/xmtp.js';
import { loadKeystore, saveKeystore } from '../../src/lib/keystore.js';
import { apiGet, apiPost } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';
import { createXmtpClient, listenForEnvelopes } from '../../src/lib/xmtp-client.js';

const keystore = {
  encryptedKey: 'abc',
  walletAddress: '0x1111111111111111111111111111111111111111',
  deviceId: 'device-1',
  apiToken: 'token-1',
  agentId: null,
};

describe('xmtp command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadKeystore).mockResolvedValue(keystore as any);
  });

  it('init bootstraps xmtp and persists keystore metadata', async () => {
    vi.mocked(createXmtpClient).mockResolvedValue({
      inboxId: 'inbox-1',
      installationId: 'install-1',
      dbPath: '/tmp/xmtp.db',
    } as any);
    vi.mocked(apiPost).mockResolvedValue({
      inboxId: 'inbox-1',
      installationId: 'install-1',
      policyMode: 'allowlist',
    } as any);

    await xmtpCommand.parseAsync(['node', 'xmtp', 'init'], { from: 'node' });

    expect(apiPost).toHaveBeenCalledWith('/api/xmtp/bootstrap', expect.any(Object));
    expect(saveKeystore).toHaveBeenCalledWith(
      expect.objectContaining({
        xmtpInboxId: 'inbox-1',
        xmtpInstallationId: 'install-1',
      })
    );
    expect(printResult).toHaveBeenCalledWith({ policyMode: 'allowlist' });
  });

  it('status fetches backend status and prints it', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      inboxId: 'inbox-1',
      enabled: true,
      activeInstallations: [{ installationId: 'install-1', status: 'active' }],
    } as any);

    await xmtpCommand.parseAsync(['node', 'xmtp', 'status'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledWith('/api/xmtp/status?deviceId=device-1', {
      headers: {
        'x-taskmarket-api-token': 'token-1',
      },
    });
    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxId: 'inbox-1',
        enabled: true,
      })
    );
  });

  it('listen wires abort signal on SIGINT', async () => {
    vi.mocked(createXmtpClient).mockResolvedValue({
      inboxId: 'inbox-1',
      installationId: 'install-1',
      dbPath: '/tmp/xmtp.db',
    } as any);

    vi.mocked(listenForEnvelopes).mockImplementation(async (options: any) => {
      process.emit('SIGINT');
      expect(options.shouldStop()).toBe(true);
      expect(options.signal?.aborted).toBe(true);
    });

    await xmtpCommand.parseAsync(['node', 'xmtp', 'listen'], { from: 'node' });

    expect(listenForEnvelopes).toHaveBeenCalledTimes(1);
  });
});
