// Verifies: ADR-0080 (the CLI reads the server's queue rather than deriving its own worklist)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above top-level const declarations, so the
// address is a literal here (not the ADDRESS const below) to avoid a TDZ
// ReferenceError.
vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi
    .fn()
    .mockResolvedValue({ walletAddress: '0xRequester0000000000000000000000000000001' }),
}));

const mockSignMessage = vi.hoisted(() => vi.fn().mockResolvedValue('0xsignature'));
vi.mock('../../src/lib/signer.js', () => ({
  createWalletAccountFromKeystore: vi.fn().mockResolvedValue({ signMessage: mockSignMessage }),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [], total: 0, urgentTotal: 0, waiting: [] }),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn(() => {
    throw new Error('printError called');
  }),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { actionsCommand } from '../../src/commands/actions.js';
import { apiGet } from '../../src/lib/api.js';
import { createWalletAccountFromKeystore } from '../../src/lib/signer.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { printResult } from '../../src/lib/output.js';

const ADDRESS = '0xRequester0000000000000000000000000000001';

const QUEUE = {
  items: [
    {
      id: 'task-1:evaluate_work',
      intent: 'evaluate_work',
      role: 'evaluator',
      priority: 'urgent',
      dueAt: '2026-08-12T00:00:00.000Z',
      actions: [{ action: 'evaluate', role: 'evaluator' }],
      task: { id: 'task-1' },
    },
  ],
  total: 1,
  urgentTotal: 1,
  waiting: [{ id: 'task-2:waiting', reason: 'waiting_for_submissions', task: { id: 'task-2' } }],
};

describe('actions command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignMessage.mockResolvedValue('0xsignature');
    vi.mocked(createWalletAccountFromKeystore).mockResolvedValue({
      signMessage: mockSignMessage,
    } as unknown as Awaited<ReturnType<typeof createWalletAccountFromKeystore>>);
  });

  it('reads the action queue for the keystore wallet with a read-auth signature', async () => {
    vi.mocked(apiGet).mockResolvedValue(QUEUE);

    await actionsCommand.parseAsync(['node', 'actions'], { from: 'node' });

    expect(mockSignMessage).toHaveBeenCalledTimes(1);
    expect(mockSignMessage).toHaveBeenCalledWith({
      message: `taskmarket:read:${ADDRESS.toLowerCase()}`,
    });

    const [url, options] = vi.mocked(apiGet).mock.calls[0];
    expect(url).toContain('/api/agents/action-queue');
    expect(url).toContain(`address=${encodeURIComponent(ADDRESS)}`);
    expect(options?.headers).toEqual({
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('hits the action queue rather than the task-list inbox', async () => {
    // The two commands answer different questions over different endpoints (ADR-0080). This is
    // the assertion that keeps them apart: a refactor that pointed `actions` at
    // `/api/agents/inbox` would still print a plausible-looking envelope.
    vi.mocked(apiGet).mockResolvedValue(QUEUE);

    await actionsCommand.parseAsync(['node', 'actions'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(apiGet).mock.calls[0];
    expect(url).not.toContain('/api/agents/inbox');
  });

  it('prints the server envelope verbatim, without re-deriving or filtering it', async () => {
    // Grouping, urgency, and the `refund_expired` suppression are the server's (issue #432).
    // A client that filtered here would be re-deriving the worklist the queue exists to own,
    // so the totals and the waiting list must survive untouched.
    vi.mocked(apiGet).mockResolvedValue(QUEUE);

    await actionsCommand.parseAsync(['node', 'actions'], { from: 'node' });

    expect(printResult).toHaveBeenCalledWith(QUEUE);
  });

  it('falls back to an unsigned request when signing fails', async () => {
    // Public visibility still answers; the caller simply sees less than a self-authed one does.
    mockSignMessage.mockRejectedValue(new Error('signing failed'));
    vi.mocked(apiGet).mockResolvedValue({ items: [], total: 0, urgentTotal: 0, waiting: [] });

    await actionsCommand.parseAsync(['node', 'actions'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(apiGet).mock.calls[0];
    expect(options?.headers).toEqual({});
  });

  it('errors when there is no keystore at all', async () => {
    vi.mocked(loadKeystore).mockRejectedValueOnce(new Error('no keystore'));

    await expect(actionsCommand.parseAsync(['node', 'actions'], { from: 'node' })).rejects.toThrow(
      'printError called'
    );
    expect(apiGet).not.toHaveBeenCalled();
  });
});
