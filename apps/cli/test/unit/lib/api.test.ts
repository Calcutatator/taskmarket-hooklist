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
  };
}

describe('ApiError', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
    await expect(apiPost('/api/tasks', {})).resolves.toEqual({ ok: true });
  });
});
