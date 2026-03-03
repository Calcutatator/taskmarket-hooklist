import { describe, it, expect } from 'vitest';
import { XmtpQueryManager } from '../../src/lib/xmtp-query.js';

const BASE_ENVELOPE = {
  schemaVersion: 1 as const,
  type: 'task.query',
  requestId: '3ca9253f-b16f-4ff5-b6db-7d3e123d89aa',
  senderInboxId: 'inbox-a',
  senderAddress: '0x1111111111111111111111111111111111111111',
  sentAt: '2026-03-03T00:00:00.000Z',
  payload: { ping: true },
};

describe('XmtpQueryManager', () => {
  it('resolves pending query when correlated response arrives', async () => {
    const manager = new XmtpQueryManager();
    const waitPromise = manager.waitForResponse(BASE_ENVELOPE.requestId, 200);

    const resolved = manager.resolveResponse({
      ...BASE_ENVELOPE,
      requestId: '40c2da5a-0f61-4e20-a8af-df7aad9ab8a2',
      replyToRequestId: BASE_ENVELOPE.requestId,
      type: 'task.response',
    });

    const response = await waitPromise;

    expect(resolved).toBe(true);
    expect(response.replyToRequestId).toBe(BASE_ENVELOPE.requestId);
  });

  it('times out pending query when no response arrives', async () => {
    const manager = new XmtpQueryManager();

    await expect(manager.waitForResponse(BASE_ENVELOPE.requestId, 10)).rejects.toThrow(
      'timed out'
    );
  });

  it('ignores unmatched response IDs', async () => {
    const manager = new XmtpQueryManager();
    const waitPromise = manager.waitForResponse(BASE_ENVELOPE.requestId, 200);

    const resolved = manager.resolveResponse({
      ...BASE_ENVELOPE,
      requestId: '40c2da5a-0f61-4e20-a8af-df7aad9ab8a2',
      replyToRequestId: '1ce4742a-a775-4eb4-940a-a468e8cffb36',
      type: 'task.response',
    });

    expect(resolved).toBe(false);
    manager.resolveResponse({
      ...BASE_ENVELOPE,
      requestId: '40c2da5a-0f61-4e20-a8af-df7aad9ab8a2',
      replyToRequestId: BASE_ENVELOPE.requestId,
      type: 'task.response',
    });

    await expect(waitPromise).resolves.toBeDefined();
  });
});
