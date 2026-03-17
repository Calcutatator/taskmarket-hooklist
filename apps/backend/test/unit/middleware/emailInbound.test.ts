import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../../src/services/smtp', () => ({
  storeInboundEmail: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    EMAIL_WEBHOOK_SECRET: 'a-very-long-secret-that-is-at-least-32-chars',
    NODE_ENV: 'test',
  }),
}));

vi.mock('../../../src/db/client', () => ({
  db: {},
}));

import { emailInboundHandler } from '../../../src/middleware/emailInbound';
import { storeInboundEmail } from '../../../src/services/smtp';

const VALID_SECRET = 'a-very-long-secret-that-is-at-least-32-chars';
const VALID_FROM = 'sender@example.com';
const VALID_TO = 'alice@daydreams.systems';
const RAW_EMAIL = Buffer.from('From: sender@example.com\r\nTo: alice@daydreams.systems\r\n\r\nHello');

function makeReqRes(overrides: {
  headers?: Record<string, string>;
  body?: Buffer;
}): { req: Request; res: Response; jsonSpy: ReturnType<typeof vi.fn>; statusSpy: ReturnType<typeof vi.fn> } {
  const jsonSpy = vi.fn();
  const statusSpy = vi.fn().mockReturnThis();
  const res = {
    status: statusSpy,
    json: jsonSpy,
  } as unknown as Response;

  const req = {
    headers: overrides.headers ?? {
      'x-webhook-secret': VALID_SECRET,
      'x-email-from': VALID_FROM,
      'x-email-to': VALID_TO,
    },
    body: overrides.body ?? RAW_EMAIL,
  } as unknown as Request;

  return { req, res, jsonSpy, statusSpy };
}

describe('emailInboundHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores email and returns 200 for valid request', async () => {
    vi.mocked(storeInboundEmail).mockResolvedValue(undefined);
    const { req, res, statusSpy, jsonSpy } = makeReqRes({});

    await emailInboundHandler(req, res);

    expect(storeInboundEmail).toHaveBeenCalledWith({}, RAW_EMAIL, [VALID_TO]);
    expect(statusSpy).not.toHaveBeenCalled();
    expect(jsonSpy).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 400 when required headers are missing', async () => {
    const { req, res, statusSpy, jsonSpy } = makeReqRes({
      headers: { 'x-webhook-secret': VALID_SECRET },
    });

    await emailInboundHandler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(storeInboundEmail).not.toHaveBeenCalled();
  });

  it('returns 401 when webhook secret is wrong', async () => {
    const { req, res, statusSpy, jsonSpy } = makeReqRes({
      headers: {
        'x-webhook-secret': 'wrong-secret',
        'x-email-from': VALID_FROM,
        'x-email-to': VALID_TO,
      },
    });

    await emailInboundHandler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(storeInboundEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when x-email-to is not a valid email', async () => {
    const { req, res, statusSpy, jsonSpy } = makeReqRes({
      headers: {
        'x-webhook-secret': VALID_SECRET,
        'x-email-from': VALID_FROM,
        'x-email-to': 'not-an-email',
      },
    });

    await emailInboundHandler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('returns 200 (silent skip) when recipient is unknown', async () => {
    // storeInboundEmail resolves normally — unknown recipients are silently skipped inside it
    vi.mocked(storeInboundEmail).mockResolvedValue(undefined);
    const { req, res, jsonSpy } = makeReqRes({
      headers: {
        'x-webhook-secret': VALID_SECRET,
        'x-email-from': VALID_FROM,
        'x-email-to': 'unknown@daydreams.systems',
      },
    });

    await emailInboundHandler(req, res);

    expect(storeInboundEmail).toHaveBeenCalledWith({}, expect.anything(), [
      'unknown@daydreams.systems',
    ]);
    expect(jsonSpy).toHaveBeenCalledWith({ ok: true });
  });
});
