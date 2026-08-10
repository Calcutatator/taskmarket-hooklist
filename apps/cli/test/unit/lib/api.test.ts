// Verifies: RFC-0006 Tier 2 CLI structured-status change
// docs/specs/submission-tier-2-hard-ceiling.md "CLI: structured status on the existing JSON
// error envelope" -- Testing & Verification cases 15-16.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ApiError, apiDelete, apiGet, apiPost } from '../../../src/lib/api.js';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** What a proxy or gateway actually answers when it fails: not JSON, and often not even close. */
function nonJsonResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError(`Unexpected token < in JSON at position 0`);
    },
    text: async () => body,
  };
}

describe('ApiError', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('still raises an ApiError with the real status when the error body is not JSON', async () => {
    // Reading the body with `res.json()` made the SyntaxError itself propagate, so the status,
    // the idempotency key and the ADR-0058 envelope were all replaced by a parse error. The
    // failures most likely to arrive as HTML are the infrastructure ones -- exactly the failures
    // most likely to have left a paid write in flight, and so the worst ones to lose the status
    // of. See readFailureBody in src/lib/api.ts.
    mockFetch.mockResolvedValue(nonJsonResponse(502, '<html><body>Bad Gateway</body></html>'));

    const caught = await apiPost('/api/tasks/0xabc/cancel', { taskId: '0xabc' }).then(
      () => undefined,
      (err: unknown) => err
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(502);
    expect((caught as ApiError).message).toContain('Bad Gateway');
    // No envelope existed to carry, and none is invented -- an unclassified failure must not
    // read as evidence that nothing is in flight.
    expect((caught as ApiError).envelope).toBeUndefined();
    expect((caught as ApiError).idempotencyKey).toBeDefined();
  });

  it('still raises an ApiError with the real status when a GET error body is empty', async () => {
    mockFetch.mockResolvedValue(nonJsonResponse(504, ''));

    const caught = await apiGet('/api/tasks/0xabc').then(
      () => undefined,
      (err: unknown) => err
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(504);
  });

  it('apiPost throws ApiError (instanceof ApiError and Error) with .status set to the real HTTP status, message unchanged from today', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(429, {
        error: 'This task has reached its maximum number of submissions from this worker.',
      })
    );

    let caught: unknown;
    try {
      await apiPost('/api/tasks/0xabc/submissions', { taskId: '0xabc' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as ApiError).status).toBe(429);
    expect((caught as ApiError).message).toBe(
      `POST /api/tasks/0xabc/submissions failed (429): ${JSON.stringify({ error: 'This task has reached its maximum number of submissions from this worker.' })}`
    );
  });

  it('apiGet throws ApiError with the real HTTP status', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'internal' }));

    let caught: unknown;
    try {
      await apiGet('/api/tasks/0xabc');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as ApiError).status).toBe(500);
  });

  it('apiDelete throws ApiError with the real HTTP status', async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { error: 'not found' }));

    let caught: unknown;
    try {
      await apiDelete('/api/tasks/0xabc/some-resource');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as ApiError).status).toBe(404);
  });

  it('does not throw on a 2xx response', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));
    await expect(apiPost('/api/tasks', {})).resolves.toMatchObject({ data: { ok: true } });
  });
});
