import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeChain } from './helpers';

vi.mock('../../src/db/client', () => ({ db: { select: vi.fn() } }));
vi.mock('../../src/context', () => ({
  resolveCaller: vi.fn(),
  resolveTaskAccessGrant: vi.fn(),
}));
vi.mock('../../src/lib/task-visibility', () => ({
  resolveTaskViewability: vi.fn(),
}));
vi.mock('../../src/lib/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { feedbackFileHandler } from '../../src/routes/feedback';
import { db } from '../../src/db/client';
import { resolveCaller, resolveTaskAccessGrant } from '../../src/context';
import { resolveTaskViewability } from '../../src/lib/task-visibility';

const FEEDBACK_ID = 'feedback-1';
const TASK_ID = '0x7461736b00000000000000000000000000000000000000000000000000000001';

function makeReqRes(id = FEEDBACK_ID) {
  const req = { params: { id }, headers: {} } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  } as any;
  return { req, res };
}

describe('GET /api/feedback/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 without leaking content when the caller cannot view the task', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeChain([{ taskId: TASK_ID, fileContent: '{"secret":"private feedback"}' }])
    );
    vi.mocked(resolveCaller).mockResolvedValue(undefined);
    vi.mocked(resolveTaskAccessGrant).mockResolvedValue(undefined);
    vi.mocked(resolveTaskViewability).mockResolvedValue({ task: null, viewable: false } as any);

    const { req, res } = makeReqRes();
    await feedbackFileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('returns the same 404 shape for a nonexistent feedbackId (no distinguishing signal)', async () => {
    vi.mocked(db.select).mockReturnValueOnce(makeChain([]));

    const { req, res } = makeReqRes('does-not-exist');
    await feedbackFileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(resolveTaskViewability).not.toHaveBeenCalled();
  });

  it('serves fileContent when the caller can view the task', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeChain([{ taskId: TASK_ID, fileContent: '{"rating":88}' }])
    );
    vi.mocked(resolveCaller).mockResolvedValue({ address: '0xrequester' });
    vi.mocked(resolveTaskAccessGrant).mockResolvedValue(undefined);
    vi.mocked(resolveTaskViewability).mockResolvedValue({ task: {} as any, viewable: true });

    const { req, res } = makeReqRes();
    await feedbackFileHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('{"rating":88}');
  });

  it('serves fileContent for a public task with no caller at all (unchanged happy path)', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeChain([{ taskId: TASK_ID, fileContent: '{"rating":75}' }])
    );
    vi.mocked(resolveCaller).mockResolvedValue(undefined);
    vi.mocked(resolveTaskAccessGrant).mockResolvedValue(undefined);
    vi.mocked(resolveTaskViewability).mockResolvedValue({ task: {} as any, viewable: true });

    const { req, res } = makeReqRes();
    await feedbackFileHandler(req, res);

    expect(res.send).toHaveBeenCalledWith('{"rating":75}');
  });
});
