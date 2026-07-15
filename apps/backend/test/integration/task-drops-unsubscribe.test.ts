import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTaskDropsUnsubscribeDetails, unsubscribeTaskDropsSubscription } = vi.hoisted(() => ({
  getTaskDropsUnsubscribeDetails: vi.fn(),
  unsubscribeTaskDropsSubscription: vi.fn(),
}));

const FAKE_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FAKE_PRIVATE_KEY = `0x${'1'.repeat(64)}`;

vi.mock('../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    NODE_ENV: 'test',
    PORT: 3000,
    CORS_ORIGIN: '*',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: FAKE_ADDRESS,
    USDC_TOKEN_ADDRESS: FAKE_ADDRESS,
    USDC_DOMAIN_NAME: 'USDC',
    SERVER_PRIVATE_KEY: FAKE_PRIVATE_KEY,
    X402_FACILITATOR_URL: 'https://facilitator.example',
    X402_FACILITATOR_TOKEN: undefined,
    BACKEND_URL: 'http://localhost:3000',
    WEB_APP_URL: 'https://taskmarket.example',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    ERC8004_IDENTITY_REGISTRY: FAKE_ADDRESS,
    ERC8004_REPUTATION_REGISTRY: FAKE_ADDRESS,
    XMTP_ENABLED: false,
    XMTP_POLICY_DEFAULT: 'open',
    EMAIL_DOMAIN: 'taskmarket.example',
  }),
}));

vi.mock('../../src/db/client', () => ({ db: {} }));

vi.mock('../../src/services/task-drops-email', () => ({
  getTaskDropsUnsubscribeDetails,
  unsubscribeTaskDropsSubscription,
}));

vi.mock('../../src/lib/wallet', () => ({
  createServerWallet: vi.fn().mockReturnValue({ address: FAKE_ADDRESS }),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  morganStream: { write: vi.fn() },
}));

vi.mock('../../src/lib/openapi', () => ({
  generateOpenAPI: vi.fn().mockReturnValue({ openapi: '3.0.0', info: {}, paths: {} }),
}));

vi.mock('../../src/router', () => ({
  appRouter: { createCaller: vi.fn(), _def: { procedures: {} } },
}));

vi.mock('../../src/context', () => ({
  createContext: vi.fn().mockReturnValue({}),
}));

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

const { app } = await import('../../src/app');

describe('Task Drops unsubscribe HTTP flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTaskDropsUnsubscribeDetails.mockResolvedValue({
      email: 'alice@example.com',
      scope: 'official',
    });
  });

  it('requires confirmation without mutating on GET', async () => {
    const response = await request(app).get('/task-drops/unsubscribe?id=sub-1&token=token-1');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Confirm unsubscribe');
    expect(response.text).toContain('all official Task Drop announcements');
    expect(response.text).toContain('method="post"');
    expect(getTaskDropsUnsubscribeDetails).toHaveBeenCalledWith({
      db: expect.anything(),
      id: 'sub-1',
      token: 'token-1',
    });
    expect(unsubscribeTaskDropsSubscription).not.toHaveBeenCalled();
  });

  it('uses scoped copy for exact-drop confirmation and rejects invalid tokens', async () => {
    getTaskDropsUnsubscribeDetails.mockResolvedValueOnce({
      email: 'alice@example.com',
      scope: 'drop',
    });
    const exactResponse = await request(app).get(
      '/task-drops/unsubscribe?id=sub-1&token=token-1'
    );
    expect(exactResponse.text).toContain('emails for this Task Drop');

    getTaskDropsUnsubscribeDetails.mockResolvedValueOnce(null);
    const invalidResponse = await request(app).get(
      '/task-drops/unsubscribe?id=sub-1&token=invalid'
    );
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.text).toContain('Unsubscribe link expired');
  });

  it('unsubscribes only after a POST confirmation', async () => {
    unsubscribeTaskDropsSubscription.mockResolvedValue({
      email: 'alice@example.com',
      scope: 'official',
      unsubscribed: true,
    });

    const response = await request(app).post('/task-drops/unsubscribe?id=sub-1&token=token-1');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Task Drops are off');
    expect(response.text).toContain('all official Task Drops');
    expect(unsubscribeTaskDropsSubscription).toHaveBeenCalledWith({
      db: expect.anything(),
      id: 'sub-1',
      token: 'token-1',
    });
  });

  it('turns unsubscribe service failures into a controlled response', async () => {
    unsubscribeTaskDropsSubscription.mockRejectedValue(new Error('database unavailable'));

    const response = await request(app).post('/task-drops/unsubscribe?id=sub-1&token=token-1');

    expect(response.status).toBe(500);
    expect(response.text).toContain('Unable to unsubscribe');
  });
});
