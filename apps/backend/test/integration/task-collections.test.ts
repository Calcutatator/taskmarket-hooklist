import express from 'express';
import request from 'supertest';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';
import { describe, expect, it, vi } from 'vitest';
import { createMockCtx } from '../unit/helpers';

vi.mock('../../src/services/contract', () => ({
  contractSelectWorker: vi.fn(),
  contractSubmitPitch: vi.fn(),
  contractSubmitProof: vi.fn(),
  contractSubmitWork: vi.fn(),
}));

const { router } = await import('../../src/trpc');
const { pitchesRouter } = await import('../../src/routers/pitches.router');
const { proofsRouter } = await import('../../src/routers/proofs.router');

const collectionsRouter = router({ pitches: pitchesRouter, proofs: proofsRouter });
const TASK_ID = '0x7461736b00000000000000000000000000000000000000000000000000000001';

function collectionApp() {
  const ctx = createMockCtx();
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createOpenApiExpressMiddleware({
      router: collectionsRouter,
      createContext: ({ req, res }) => ({ ...ctx, req, res }),
    })
  );
  return { app, ctx };
}

describe('task collection OpenAPI routes', () => {
  it('serves the pitch collection through the REST path', async () => {
    const { app, ctx } = collectionApp();
    const response = await request(app).get(`/api/tasks/${TASK_ID}/pitches`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(ctx.db.select).toHaveBeenCalledOnce();
  });

  it('serves the proof collection through the REST path', async () => {
    const { app, ctx } = collectionApp();
    const response = await request(app).get(`/api/tasks/${TASK_ID}/proofs`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(ctx.db.select).toHaveBeenCalledOnce();
  });
});
