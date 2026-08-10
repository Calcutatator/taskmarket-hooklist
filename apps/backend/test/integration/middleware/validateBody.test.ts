import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';
import request from 'supertest';

// All heavy modules must be mocked before app is imported — vitest hoists vi.mock() calls.

const FAKE_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FAKE_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';
const mockDb = vi.hoisted(() => ({
  delete: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, { where: async () => [] });
    return chain;
  }),
  // Every paid route now *claims* the idempotency key before it challenges, by inserting a
  // reservation (ADR-0067). The insert succeeding is the "fresh key" case these tests are all
  // in; a chain that resolved to nothing would look like a lost race and answer 409 instead of
  // the 402 each of them is asserting.
  insert: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      values: () => chain,
      onConflictDoNothing: () => chain,
      returning: async () => [{ id: 'reserved-intent', status: 'reserved' }],
    });
    return chain;
  }),
  update: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, { set: () => chain, where: async () => [] });
    return chain;
  }),
  // Resolves empty by default. Tests that need a specific read override it.
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      from: () => chain,
      where: () => chain,
      limit: async () => [],
    });
    return chain;
  }),
  transaction: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    NODE_ENV: 'production',
    PORT: 3000,
    CORS_ORIGIN: '*',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: FAKE_ADDRESS,
    USDC_TOKEN_ADDRESS: FAKE_ADDRESS,
    USDC_DOMAIN_NAME: 'USDC',
    SERVER_PRIVATE_KEY: FAKE_PRIVATE_KEY,
    X402_FACILITATOR_URL: 'https://facilitator.daydreams.systems',
    X402_FACILITATOR_TOKEN: undefined,
    BACKEND_URL: 'http://localhost:3000',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    ERC8004_IDENTITY_REGISTRY: FAKE_ADDRESS,
    ERC8004_REPUTATION_REGISTRY: FAKE_ADDRESS,
    XMTP_ENABLED: false,
    XMTP_POLICY_DEFAULT: 'open',
    EMAIL_DOMAIN: 'taskmarket.dev',
    OFFICIAL_TASK_DROP_OWNER_ADDRESSES: [FAKE_ADDRESS.toLowerCase()],
  }),
}));

vi.mock('../../../src/db/client', () => ({ db: mockDb }));

vi.mock('../../../src/lib/wallet', () => ({
  createServerWallet: vi.fn().mockReturnValue({ address: FAKE_ADDRESS }),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  morganStream: { write: vi.fn() },
}));

vi.mock('../../../src/lib/openapi', () => ({
  generateOpenAPI: vi.fn().mockReturnValue({ openapi: '3.0.0', info: {}, paths: {} }),
}));

vi.mock('../../../src/router', () => ({
  appRouter: { createCaller: vi.fn(), _def: { procedures: {} } },
}));

vi.mock('../../../src/context', () => ({
  createContext: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/middleware/ogTags', () => ({
  ogTagsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../src/middleware/emailInbound', () => ({
  emailInboundHandler: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('@trpc/server/adapters/express', () => ({
  createExpressMiddleware: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('trpc-to-openapi', () => ({
  createOpenApiExpressMiddleware: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
}));

// Import after all mocks are registered
const { app: expressApp } = await import('../../../src/app');
expressApp.get('/__test/client-ip', (req, res) => res.json({ ip: req.ip }));
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

function mockLockedTaskDrop(drop: {
  announcedAt?: Date | null;
  id: string;
  ownerAddress: string;
}) {
  const reservationValues = vi.fn().mockResolvedValue(undefined);
  const tx = {
    insert: vi.fn().mockReturnValue({ values: reservationValues }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            for: vi.fn().mockResolvedValue([drop]),
          }),
        }),
      }),
    }),
  };
  mockDb.transaction.mockImplementationOnce(async (callback) => callback(tx));
  return { reservationValues, tx };
}

describe('proxy configuration', () => {
  it('uses the address supplied by the nearest forwarding proxy in production', async () => {
    expect(expressApp.get('trust proxy')).toBe(1);

    const res = await request(app)
      .get('/__test/client-ip')
      .set('X-Forwarded-For', '198.51.100.20, 203.0.113.10');

    expect(res.body).toEqual({ ip: '203.0.113.10' });
  });
});

describe('validateBody integration — routes block invalid bodies before x402', () => {
  // For 400 tests: invalid body → validateBody short-circuits, x402 never runs
  // For 402 tests: valid body, no payment signature → validateBody passes, x402 requests payment

  describe('POST /api/tasks', () => {
    const validBody = {
      description: 'Build a thing',
      reward: '5000000',
      duration: 24,
      tags: [],
    };

    it('returns 400 (not 402) when description exceeds 10000 chars', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, description: 'x'.repeat(10001) });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when description is missing', async () => {
      const { description: _omit, ...body } = validBody;
      const res = await request(app).post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when tags array has more than 10 items', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(validBody);
      expect(res.status).toBe(402);
    });

    it('rejects an existing drop owned by another wallet before settling payment', async () => {
      mockLockedTaskDrop({
        id: 'drop_other_owner',
        ownerAddress: OTHER_ADDRESS,
      });
      const facilitator = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, transaction: '0xpayment' }),
        ok: true,
      });
      vi.stubGlobal('fetch', facilitator);
      const payment = Buffer.from(
        JSON.stringify({
          accepted: {
            amount: validBody.reward,
            asset: FAKE_ADDRESS,
            network: 'eip155:84532',
            payTo: FAKE_ADDRESS,
            scheme: 'exact',
          },
          payload: {
            authorization: {
              from: FAKE_ADDRESS,
              to: FAKE_ADDRESS,
              value: validBody.reward,
              validBefore: String(Math.floor(Date.now() / 1000) + 300),
            },
          },
          x402Version: 2,
        })
      ).toString('base64');

      const res = await request(app)
        .post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .set('PAYMENT-SIGNATURE', payment)
        .send({ ...validBody, taskDropId: 'drop_other_owner' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual(
        expect.objectContaining({ error: 'Task drop is not owned by payer' })
      );
      expect(facilitator).not.toHaveBeenCalled();
    });

    it('rejects an announced official drop before settling payment', async () => {
      mockLockedTaskDrop({
        announcedAt: new Date('2026-07-15T00:00:00.000Z'),
        id: 'drop_announced',
        ownerAddress: FAKE_ADDRESS,
      });
      const facilitator = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, transaction: '0xpayment' }),
        ok: true,
      });
      vi.stubGlobal('fetch', facilitator);
      const payment = Buffer.from(
        JSON.stringify({
          accepted: {
            amount: validBody.reward,
            asset: FAKE_ADDRESS,
            network: 'eip155:84532',
            payTo: FAKE_ADDRESS,
            scheme: 'exact',
          },
          payload: {
            authorization: {
              from: FAKE_ADDRESS,
              to: FAKE_ADDRESS,
              value: validBody.reward,
              validBefore: String(Math.floor(Date.now() / 1000) + 300),
            },
          },
          x402Version: 2,
        })
      ).toString('base64');

      const res = await request(app)
        .post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .set('PAYMENT-SIGNATURE', payment)
        .send({ ...validBody, taskDropId: 'drop_announced' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(
        expect.objectContaining({ error: 'Official task drop has already been announced' })
      );
      expect(facilitator).not.toHaveBeenCalled();
    });

    it('reserves an existing drop before settlement and releases it when settlement fails', async () => {
      const lockedDrop = {
        announcedAt: null,
        id: 'drop_payment_race',
        ownerAddress: FAKE_ADDRESS,
      };
      const reservationWhere = vi.fn().mockResolvedValue(undefined);
      const { reservationValues } = mockLockedTaskDrop(lockedDrop);
      mockDb.delete.mockReturnValue({ where: reservationWhere });
      const facilitator = vi.fn().mockImplementation(async () => {
        expect(reservationValues).toHaveBeenCalledOnce();
        return {
          ok: false,
          status: 503,
          text: async () => 'unavailable',
        };
      });
      vi.stubGlobal('fetch', facilitator);
      const payment = Buffer.from(
        JSON.stringify({
          accepted: {
            amount: validBody.reward,
            asset: FAKE_ADDRESS,
            network: 'eip155:84532',
            payTo: FAKE_ADDRESS,
            scheme: 'exact',
          },
          payload: {
            authorization: {
              from: FAKE_ADDRESS,
              to: FAKE_ADDRESS,
              value: validBody.reward,
              validBefore: String(Math.floor(Date.now() / 1000) + 300),
            },
          },
          x402Version: 2,
        })
      ).toString('base64');

      const res = await request(app)
        .post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .set('PAYMENT-SIGNATURE', payment)
        .send({ ...validBody, taskDropId: lockedDrop.id });

      expect(res.status).toBe(402);
      expect(facilitator).toHaveBeenCalledOnce();
      expect(reservationValues).toHaveBeenCalledWith(
        expect.objectContaining({ taskDropId: lockedDrop.id })
      );
      expect(reservationWhere).toHaveBeenCalled();
    });

    it('rejects a divergent auction max price before requesting payment', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({
          ...validBody,
          mode: 'auction',
          auctionType: 'english',
          maxPrice: '4000000',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('maxPrice must equal reward');
    });
  });

  describe('POST /api/tasks/:taskId/accept', () => {
    const validBody = { taskId: '0xtask', worker: FAKE_ADDRESS };

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/accept')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/accept-submissions', () => {
    const validBody = {
      taskId: '0xtask',
      winners: [{ worker: FAKE_ADDRESS, share: 10000, deliverable: `0x${'ab'.repeat(32)}` }],
    };

    it('returns 400 (not 402) when shares do not sum to 10000', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/accept-submissions')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({
          taskId: '0xtask',
          winners: [
            { worker: FAKE_ADDRESS, share: 5000 },
            { worker: '0xother', share: 3000 },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when winners array is empty', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/accept-submissions')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ taskId: '0xtask', winners: [] });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/accept-submissions')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/rate', () => {
    const validBody = { taskId: '0xtask', worker: FAKE_ADDRESS, rating: 80 };

    it('returns 400 (not 402) when rating exceeds 100', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/rate')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, rating: 101 });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when rating is negative', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/rate')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, rating: -1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when feedbackText exceeds 500 chars', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/rate')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, feedbackText: 'x'.repeat(501) });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/rate')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/update', () => {
    it('returns 402 when description is exactly 10000 chars and no payment is provided', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ taskId: '0xtask', description: 'x'.repeat(10000) });
      expect(res.status).toBe(402);
    });

    it('returns 400 (not 402) when description exceeds 10000 chars', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ taskId: '0xtask', description: 'x'.repeat(10001) });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when tags array exceeds 10 items', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({
          taskId: '0xtask',
          tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
        });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ taskId: '0xtask', description: 'updated description' });
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/pitches', () => {
    const validBody = {
      taskId: '0xtask',
      workerAddress: FAKE_ADDRESS,
      pitchText: 'Here is my approach',
      signature: '0xsig',
    };

    it('returns 400 (not 402) when pitchText is empty', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/pitches')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, pitchText: '' });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/pitches')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/proofs', () => {
    const validBody = {
      taskId: '0xtask',
      workerAddress: FAKE_ADDRESS,
      proofData: 'valid proof',
      proofType: 'manual',
      signature: '0xsig',
    };

    it('returns 400 (not 402) when proofData exceeds 10000 chars', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/proofs')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ ...validBody, proofData: 'x'.repeat(10001) });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/proofs')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID()).send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('evaluator payment routes', () => {
    it.each([
      ['/api/tasks/0xtask/evaluate', { taskId: '0xtask', verdict: 'approve' }],
      ['/api/tasks/0xtask/appeal', { taskId: '0xtask' }],
      [
        '/api/tasks/0xtask/resolve-dispute',
        {
          taskId: '0xtask',
          verdict: 'approve',
          awards: [{ worker: FAKE_ADDRESS, amount: '1000000', rank: 1 }],
        },
      ],
      ['/api/tasks/0xtask/evaluator-timeout', { taskId: '0xtask' }],
    ])('returns 402 for an unpaid valid request to %s', async (path, body) => {
      const res = await request(app)
        .post(path)
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send(body);
      expect(res.status).toBe(402);
    });

    it('does not require payment to finalize a verdict', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/finalize-verdict')
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .send({ taskId: '0xtask' });
      expect(res.status).not.toBe(402);
    });
  });
});
