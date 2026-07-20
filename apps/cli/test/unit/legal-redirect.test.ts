import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { loadKeystore } = vi.hoisted(() => ({ loadKeystore: vi.fn() }));

vi.mock('../../src/lib/keystore.js', () => ({ loadKeystore }));

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not bind to a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('legal receipt redirect handling', () => {
  const targetReceipts: Array<string | undefined> = [];
  let apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  let x402Post: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  let apiServer: Server;
  let targetServer: Server;
  let originalApiUrl: string | undefined;

  beforeAll(async () => {
    targetServer = createServer((req, res) => {
      targetReceipts.push(req.headers['x-taskmarket-legal-receipt'] as string | undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    const targetPort = await listen(targetServer);

    apiServer = createServer((_req, res) => {
      res.writeHead(307, {
        Location: `http://127.0.0.1:${targetPort}/capture`,
      });
      res.end();
    });
    const apiPort = await listen(apiServer);
    const apiUrl = `http://127.0.0.1:${apiPort}`;

    originalApiUrl = process.env.TASKMARKET_API_URL;
    process.env.TASKMARKET_API_URL = apiUrl;
    loadKeystore.mockResolvedValue({
      legalAcceptanceApiOrigin: apiUrl,
      legalAcceptanceReceipt: 'receipt-secret',
    });
    vi.resetModules();
    ({ apiPost } = await import('../../src/lib/api.js'));
    ({ x402Post } = await import('../../src/lib/x402.js'));
  });

  afterAll(async () => {
    if (originalApiUrl === undefined) delete process.env.TASKMARKET_API_URL;
    else process.env.TASKMARKET_API_URL = originalApiUrl;
    await Promise.all([close(apiServer), close(targetServer)]);
  });

  it('refuses a cross-origin redirect instead of forwarding the receipt', async () => {
    await expect(apiPost('/api/tasks', { description: 'task' })).rejects.toThrow();
    expect(targetReceipts).toEqual([]);
  });

  it('refuses a cross-origin redirect during x402 discovery', async () => {
    await expect(x402Post('/api/tasks', { description: 'task' })).rejects.toThrow();
    expect(targetReceipts).toEqual([]);
  });
});
