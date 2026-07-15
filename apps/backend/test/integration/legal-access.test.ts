import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const FAKE_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FAKE_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';

const { authenticateXmtpDevice, verifyLegalReceipt } = vi.hoisted(() => ({
  authenticateXmtpDevice: vi.fn(),
  verifyLegalReceipt: vi.fn(),
}));

vi.mock('../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    BACKEND_URL: 'http://localhost:3000',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: FAKE_ADDRESS,
    CORS_ORIGIN: '*',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    EMAIL_DOMAIN: 'taskmarket.dev',
    ERC8004_IDENTITY_REGISTRY: FAKE_ADDRESS,
    ERC8004_REPUTATION_REGISTRY: FAKE_ADDRESS,
    LEGAL_ENFORCEMENT_ENABLED: true,
    NODE_ENV: 'test',
    PORT: 3000,
    SERVER_PRIVATE_KEY: FAKE_PRIVATE_KEY,
    TRUST_PROXY_HOPS: 0,
    USDC_DOMAIN_NAME: 'USDC',
    USDC_TOKEN_ADDRESS: FAKE_ADDRESS,
    WEB_APP_URL: 'https://taskmarket.example',
    X402_FACILITATOR_TOKEN: undefined,
    X402_FACILITATOR_URL: 'https://facilitator.daydreams.systems',
    XMTP_ENABLED: false,
    XMTP_POLICY_DEFAULT: 'open',
  }),
}));

vi.mock('../../src/db/client', () => ({ db: {} }));

vi.mock('../../src/lib/wallet', () => ({
  createServerWallet: vi.fn().mockReturnValue({ address: FAKE_ADDRESS }),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  morganStream: { write: vi.fn() },
}));

vi.mock('../../src/lib/openapi', () => ({
  generateOpenAPI: vi.fn().mockReturnValue({ info: {}, openapi: '3.0.0', paths: {} }),
}));

vi.mock('../../src/router', () => ({
  appRouter: { _def: { procedures: {} }, createCaller: vi.fn() },
}));

vi.mock('../../src/context', () => ({ createContext: vi.fn().mockReturnValue({}) }));

vi.mock('../../src/services/legal', () => ({
  LEGAL_ACCEPTANCE_REQUIRED_CODE: 'LEGAL_ACCEPTANCE_REQUIRED',
  getCurrentLegalBundle: () => ({ version: '2026-07-1' }),
  getCurrentLegalDocument: vi.fn(),
  verifyLegalReceipt,
}));

vi.mock('../../src/services/xmtp-auth', () => ({ authenticateXmtpDevice }));

vi.mock('../../src/middleware/ogTags', () => ({
  ogTagsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/middleware/emailInbound', () => ({
  emailInboundHandler: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('@trpc/server/adapters/express', () => ({
  createExpressMiddleware: vi
    .fn()
    .mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('trpc-to-openapi', () => ({
  createOpenApiExpressMiddleware: vi
    .fn()
    .mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
}));

const { app: expressApp } = await import('../../src/app');
const app = createServer(expressApp);

beforeAll(
  () =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      app.once('error', onError);
      app.listen(0, '127.0.0.1', () => {
        app.off('error', onError);
        resolve();
      });
    })
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      app.close((error) => (error ? reject(error) : resolve()));
    })
);

beforeEach(() => {
  vi.clearAllMocks();
  verifyLegalReceipt.mockResolvedValue(null);
});

describe('legal access integration', () => {
  it('requires acceptance before registering a device and marketplace identity', async () => {
    const response = await request(app).post('/api/devices').send({ walletAddress: FAKE_ADDRESS });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'LEGAL_ACCEPTANCE_REQUIRED' });
  });

  it('rejects a wallet receipt for a different device-authenticated wallet', async () => {
    verifyLegalReceipt.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      subjectId: FAKE_ADDRESS,
      subjectType: 'wallet',
    });
    authenticateXmtpDevice.mockResolvedValue({
      deviceId: 'device-2',
      walletAddress: OTHER_ADDRESS,
    });

    const response = await request(app)
      .post('/api/agents/public-key')
      .set('X-Taskmarket-Legal-Receipt', 'receipt-1')
      .send({ apiToken: 'token-2', deviceId: 'device-2', publicKey: '02deadbeef' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'LEGAL_ACCEPTANCE_REQUIRED' });
    expect(authenticateXmtpDevice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ apiToken: 'token-2', deviceId: 'device-2' })
    );
  });

  it('rejects a tRPC batch when any nested device belongs to a different wallet', async () => {
    verifyLegalReceipt.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      subjectId: FAKE_ADDRESS,
      subjectType: 'wallet',
    });
    authenticateXmtpDevice.mockImplementation(
      async (_context: unknown, input: { deviceId: string }) => ({
        deviceId: input.deviceId,
        walletAddress: input.deviceId === 'device-1' ? FAKE_ADDRESS : OTHER_ADDRESS,
      })
    );

    const response = await request(app)
      .post('/trpc/xmtp.bootstrap%2Cxmtp.heartbeat?batch=1')
      .set('X-Taskmarket-Legal-Receipt', 'receipt-1')
      .send({
        0: { json: { apiToken: 'token-1', deviceId: 'device-1' } },
        1: { json: { apiToken: 'token-2', deviceId: 'device-2' } },
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'LEGAL_ACCEPTANCE_REQUIRED' });
    expect(authenticateXmtpDevice).toHaveBeenCalledTimes(2);
  });
});
