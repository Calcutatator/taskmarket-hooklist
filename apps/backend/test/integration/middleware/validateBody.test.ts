import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// All heavy modules must be mocked before app is imported — vitest hoists vi.mock() calls.

const FAKE_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FAKE_PRIVATE_KEY = `0x${'1'.repeat(64)}`;

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    NODE_ENV: 'test',
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
  }),
}));

vi.mock('../../../src/db/client', () => ({ db: {} }));

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
const { app } = await import('../../../src/app');

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

    it('returns 400 (not 402) when description exceeds 2000 chars', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ ...validBody, description: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when description is missing', async () => {
      const { description: _omit, ...body } = validBody;
      const res = await request(app).post('/api/tasks').send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when tags array has more than 10 items', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ ...validBody, tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks').send(validBody);
      expect(res.status).toBe(402);
    });

    it('rejects a divergent auction max price before requesting payment', async () => {
      const res = await request(app)
        .post('/api/tasks')
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
      const res = await request(app).post('/api/tasks/0xtask/accept').send(validBody);
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
        .send({ taskId: '0xtask', winners: [] });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/accept-submissions').send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/rate', () => {
    const validBody = { taskId: '0xtask', worker: FAKE_ADDRESS, rating: 80 };

    it('returns 400 (not 402) when rating exceeds 100', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/rate')
        .send({ ...validBody, rating: 101 });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when rating is negative', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/rate')
        .send({ ...validBody, rating: -1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when feedbackText exceeds 500 chars', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/rate')
        .send({ ...validBody, feedbackText: 'x'.repeat(501) });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/rate').send(validBody);
      expect(res.status).toBe(402);
    });
  });

  describe('POST /api/tasks/:taskId/update', () => {
    it('returns 400 (not 402) when description exceeds 2000 chars', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
        .send({ taskId: '0xtask', description: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
    });

    it('returns 400 (not 402) when tags array exceeds 10 items', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
        .send({
          taskId: '0xtask',
          tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
        });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/update')
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
        .send({ ...validBody, pitchText: '' });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/pitches').send(validBody);
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
        .send({ ...validBody, proofData: 'x'.repeat(10001) });
      expect(res.status).toBe(400);
    });

    it('returns 402 when body is valid but no payment is provided', async () => {
      const res = await request(app).post('/api/tasks/0xtask/proofs').send(validBody);
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
      const res = await request(app).post(path).send(body);
      expect(res.status).toBe(402);
    });

    it('does not require payment to finalize a verdict', async () => {
      const res = await request(app)
        .post('/api/tasks/0xtask/finalize-verdict')
        .send({ taskId: '0xtask' });
      expect(res.status).not.toBe(402);
    });
  });
});
