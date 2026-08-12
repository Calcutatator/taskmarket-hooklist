// Covers the stale-intent count that ADR-0053 puts on this endpoint. Deliberately carries no
// machine-readable back-pointer to that ADR: such a marker would compute its Embodiment up to
// "Verified", and the ADR reserves that word for a specific test it names and nobody has
// written -- one asserting that every terminal-failure write is accompanied by a structured
// error log. These tests are about how the count is served, so claiming it would overstate them.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

/**
 * The database client, rigged to fail on contact.
 *
 * This is the whole point of the suite rather than a convenience. `/api/health` is public,
 * unauthenticated and polled continuously, so a query on its request path is an amplification
 * vector: an attacker gets a cheap request and we get a database round trip, on the endpoint
 * whose job is to keep answering while the service is under strain. Asserting "the count is
 * cached" would not catch a query creeping back in beside it; making every access to the client
 * throw does.
 */
const db = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`health touched the database (db.${String(property)})`);
    },
  }
);
vi.mock('../../../src/db/client', () => ({ db }));

const { healthRouter } = await import('../../../src/routers/health.router');
const { clearStaleIntentSnapshot, publishStaleIntentSnapshot } =
  await import('../../../src/services/intent-health-snapshot');

afterAll(restoreServerEnvironment);

function check() {
  return healthRouter.createCaller({} as never).check({});
}

describe('health', () => {
  beforeEach(clearStaleIntentSnapshot);

  it('omits commitSha when no deploy stamped one', async () => {
    // Absence rather than a placeholder. The deploy verification looks for a specific commit,
    // and a local or unstamped process must not be able to satisfy it.
    const body = await check();

    expect(body).not.toHaveProperty('commitSha');
  });

  it('reports the stamped commit so a deploy can prove it replaced what was running', async () => {
    // The production deploy uploads with `railway up`, which used to pass `--detach` and so
    // returned before the build finished -- green whether the build succeeded, failed, or never
    // started, leaving the previous version serving underneath. A health check cannot tell those
    // apart on its own: the old process answers `ok` exactly like the new one. The commit is what
    // makes them distinguishable.
    // `getServerConfig()` re-parses process.env on every call, so stubbing is enough -- no
    // module reset, which would also discard the database double this suite depends on.
    vi.stubEnv('COMMIT_SHA', 'abc123def456');

    const body = await check();

    expect(body.commitSha).toBe('abc123def456');

    // Cleared by stubbing empty rather than `vi.unstubAllEnvs()`, which would also discard the
    // suite-level server environment and leave every later test failing config validation.
    vi.stubEnv('COMMIT_SHA', '');
  });

  it('answers without doing any database work', async () => {
    publishStaleIntentSnapshot({ staleNonTerminal: 2 });

    // The double throws on any property access at all, so this resolving is the assertion:
    // nothing on this path selected, executed, or so much as reached for the client.
    const body = await check();

    expect(body.status).toBe('ok');
    expect(body.intents?.staleNonTerminal).toBe(2);
  });

  it('omits the intent counts before any sweep has published one', async () => {
    // Also the shape a process that does not run the worker reports forever. Absence is how
    // this response already says "no answer" (see the `limits` sibling and ADR-0053's optional
    // field), and it is the honest answer: a zero here would be a reassuring number nobody
    // computed, and a consumer could not tell it from a real one.
    const body = await check();

    expect(body.intents).toBeUndefined();
    expect(body.status).toBe('ok');
  });

  it('reports when the count was computed, not when it was served', async () => {
    const measuredAt = new Date('2026-08-06T12:00:00.000Z');
    publishStaleIntentSnapshot({ measuredAt, staleNonTerminal: 0 });

    const body = await check();

    // The distinction the timestamp exists for: this zero was measured at a known moment. A
    // consumer seeing `measuredAt` fall an hour behind the wall clock knows the sweep stopped
    // running, which a bare `0` -- identical whether nothing is stuck or nothing is counting --
    // could never tell it.
    expect(body.intents).toEqual({
      measuredAt: measuredAt.toISOString(),
      staleNonTerminal: 0,
    });
    expect(body.timestamp).not.toBe(body.intents?.measuredAt);
  });

  it('serves the latest sweep, and keeps the previous one until a sweep replaces it', async () => {
    publishStaleIntentSnapshot({ staleNonTerminal: 5 });
    publishStaleIntentSnapshot({ staleNonTerminal: 1 });

    expect((await check()).intents?.staleNonTerminal).toBe(1);
    // No sweep has run in between, so the same answer is served again rather than recomputed:
    // the cost of the count follows the sweep interval, never the request rate.
    expect((await check()).intents?.staleNonTerminal).toBe(1);
  });
});
