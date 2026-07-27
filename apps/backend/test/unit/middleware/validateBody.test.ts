import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { validateBody } from '../../../src/middleware/validateBody';
import {
  TaskCreateSchema,
  ProofSubmitSchema,
  PitchCreateSchema,
  UpdateTaskInputSchema,
} from '@taskmarket/shared';
import {
  AcceptInputSchema,
  AcceptSubmissionsInputSchema,
  RateInputSchema,
} from '../../../src/schemas/acceptance.schemas';

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function makeReq(body: unknown): Request {
  return { body } as Request;
}

describe('validateBody middleware', () => {
  describe('TaskCreateSchema', () => {
    const middleware = validateBody(TaskCreateSchema);

    it('calls next() for a valid body', () => {
      const next = vi.fn();
      const req = makeReq({
        description: 'Do the thing',
        reward: '5000000',
        duration: 24,
        tags: [],
      });
      middleware(req, mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('calls next() when description is exactly 10000 chars', () => {
      const next = vi.fn();
      const req = makeReq({
        description: 'x'.repeat(10000),
        reward: '5000000',
        duration: 24,
        tags: [],
      });
      middleware(req, mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('returns 400 when description exceeds 10000 chars', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({
          description: 'x'.repeat(10001),
          reward: '5000000',
          duration: 24,
          tags: [],
        }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when description is empty', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ description: '', reward: '5000000', duration: 24, tags: [] }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when tags array exceeds 10 items', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({
          description: 'ok',
          reward: '5000000',
          duration: 24,
          tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
        }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when reward is missing', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ description: 'ok', duration: 24, tags: [] }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('UpdateTaskInputSchema', () => {
    const middleware = validateBody(UpdateTaskInputSchema);

    it('calls next() for a minimal update with only required taskId', () => {
      const next = vi.fn();
      middleware(makeReq({ taskId: '0xabc' }), mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('calls next() when description is exactly 10000 chars', () => {
      const next = vi.fn();
      middleware(
        makeReq({ taskId: '0xabc', description: 'x'.repeat(10000) }),
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it('returns 400 when description exceeds 10000 chars', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ taskId: '0xabc', description: 'x'.repeat(10001) }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when tags array exceeds 10 items', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({ taskId: '0xabc', tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when metricDescription exceeds 500 chars', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ taskId: '0xabc', metricDescription: 'x'.repeat(501) }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('AcceptInputSchema', () => {
    const middleware = validateBody(AcceptInputSchema);

    it('calls next() without deliverable', () => {
      const next = vi.fn();
      middleware(makeReq({ taskId: '0xabc', worker: '0xworker' }), mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

  });

  describe('AcceptSubmissionsInputSchema', () => {
    const middleware = validateBody(AcceptSubmissionsInputSchema);
    const DELIVERABLE_A = `0x${'aa'.repeat(32)}`;
    const DELIVERABLE_B = `0x${'bb'.repeat(32)}`;

    it('calls next() when shares sum to 10000', () => {
      const next = vi.fn();
      middleware(
        makeReq({
          taskId: '0xabc',
          winners: [
            { worker: '0xw1', share: 6000, deliverable: DELIVERABLE_A },
            { worker: '0xw2', share: 4000, deliverable: DELIVERABLE_B },
          ],
        }),
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it('returns 400 when shares do not sum to 10000', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({
          taskId: '0xabc',
          winners: [
            { worker: '0xw1', share: 5000, deliverable: DELIVERABLE_A },
            { worker: '0xw2', share: 3000, deliverable: DELIVERABLE_B },
          ],
        }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: string }).error).toContain('10000');
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when winners array is empty', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ taskId: '0xabc', winners: [] }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when a share is out of range', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({ taskId: '0xabc', winners: [{ worker: '0xw1', share: 0 }] }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('RateInputSchema', () => {
    const middleware = validateBody(RateInputSchema);

    it('calls next() for a valid rating', () => {
      const next = vi.fn();
      middleware(
        makeReq({ taskId: '0xabc', worker: '0xworker', rating: 85 }),
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it('returns 400 when rating exceeds 100', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ taskId: '0xabc', worker: '0xworker', rating: 101 }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when rating is negative', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(makeReq({ taskId: '0xabc', worker: '0xworker', rating: -1 }), res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when feedbackText exceeds 500 chars', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({
          taskId: '0xabc',
          worker: '0xworker',
          rating: 50,
          feedbackText: 'x'.repeat(501),
        }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('ProofSubmitSchema', () => {
    const middleware = validateBody(ProofSubmitSchema);

    it('returns 400 when proofData exceeds 10000 chars', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({
          taskId: '0xabc',
          workerAddress: '0xworker',
          proofData: 'x'.repeat(10001),
          proofType: 'manual',
          signature: '0xsig',
        }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('PitchCreateSchema', () => {
    const middleware = validateBody(PitchCreateSchema);

    it('returns 400 when pitchText is empty', () => {
      const next = vi.fn();
      const res = mockRes();
      middleware(
        makeReq({
          taskId: '0xabc',
          workerAddress: '0xworker',
          pitchText: '',
          signature: '0xsig',
        }),
        res,
        next
      );
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() for a valid pitch', () => {
      const next = vi.fn();
      middleware(
        makeReq({
          taskId: '0xabc',
          workerAddress: '0xworker',
          pitchText: 'Here is my approach',
          signature: '0xsig',
        }),
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
