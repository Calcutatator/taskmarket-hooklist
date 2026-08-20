import assert from "node:assert/strict";
import test from "node:test";

import { verifySlapChopHealth } from "./verify-slap-chop-health.mjs";

const expectedHealth = {
  commitSha: "a".repeat(40),
  deployEnvironment: "preview",
  service: "slap-chop-games",
  status: "ok",
};

function healthResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("accepts the exact Slap-Chop release health response", async () => {
  const requests = [];

  const health = await verifySlapChopHealth({
    attempts: 1,
    expectedCommitSha: expectedHealth.commitSha,
    expectedDeployEnvironment: expectedHealth.deployEnvironment,
    fetcher: async (url) => {
      requests.push(url.toString());
      return healthResponse(expectedHealth);
    },
    serviceUrl: "https://games.example.test/catalog?preview=123",
    sleep: async () => {},
  });

  assert.deepEqual(health, expectedHealth);
  assert.deepEqual(requests, ["https://games.example.test/api/health"]);
});

test("retries when a healthy process is still serving the previous release", async () => {
  let calls = 0;
  let sleeps = 0;

  await assert.rejects(
    verifySlapChopHealth({
      attempts: 2,
      delayMs: 1,
      expectedCommitSha: expectedHealth.commitSha,
      expectedDeployEnvironment: expectedHealth.deployEnvironment,
      fetcher: async () => {
        calls += 1;
        return healthResponse({ ...expectedHealth, commitSha: "b".repeat(40) });
      },
      serviceUrl: "https://games.example.test",
      sleep: async () => {
        sleeps += 1;
      },
    }),
    (error) => {
      assert.match(
        error.message,
        /did not report commit=a{40} environment=preview/,
      );
      assert.doesNotMatch(error.message, /b{40}/);
      return true;
    },
  );

  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
});

test("rejects a non-HTTP health URL before making a request", async () => {
  await assert.rejects(
    verifySlapChopHealth({
      attempts: 1,
      expectedCommitSha: expectedHealth.commitSha,
      expectedDeployEnvironment: expectedHealth.deployEnvironment,
      fetcher: async () => {
        throw new Error("fetcher should not run");
      },
      serviceUrl: "file:///tmp/slap-chop-health",
    }),
    /must use http or https/,
  );
});

test("names the kind of wait that ran out, and counts what it saw", async () => {
  // The two observed CI failures exhausted the same window in different states -- once still
  // serving the previous release, once never routable at all -- and the old message reported
  // only the last one, so the two were indistinguishable in the log.
  let calls = 0;

  await assert.rejects(
    verifySlapChopHealth({
      attempts: 3,
      delayMs: 1000,
      expectedCommitSha: expectedHealth.commitSha,
      expectedDeployEnvironment: expectedHealth.deployEnvironment,
      fetcher: async () => {
        calls += 1;
        // Not routable, then routable but stale -- the shape of a deploy the poll outran.
        return calls === 1
          ? { ok: false, status: 404 }
          : healthResponse({ ...expectedHealth, commitSha: "b".repeat(40) });
      },
      serviceUrl: "https://games.example.test",
      sleep: async () => {},
    }),
    (error) => {
      assert.match(error.message, /after 3 attempts over ~3s/);
      assert.match(error.message, /last: different release identifier/);
      assert.match(error.message, /different release identifier x2/);
      assert.match(error.message, /HTTP 404 x1/);
      assert.match(error.message, /never advanced to this release/);
      // Still never echoes a value the endpoint chose.
      assert.doesNotMatch(error.message, /b{40}/);
      return true;
    },
  );
});

test("explains a service that never became routable", async () => {
  await assert.rejects(
    verifySlapChopHealth({
      attempts: 2,
      delayMs: 1000,
      expectedCommitSha: expectedHealth.commitSha,
      expectedDeployEnvironment: expectedHealth.deployEnvironment,
      fetcher: async () => ({ ok: false, status: 404 }),
      serviceUrl: "https://games.example.test",
      sleep: async () => {},
    }),
    (error) => {
      assert.match(error.message, /HTTP 404 x2/);
      assert.match(error.message, /never routable/);
      return true;
    },
  );
});

test("reports progress for every attempt so a long wait is not silent", async () => {
  const seen = [];

  await assert.rejects(
    verifySlapChopHealth({
      attempts: 3,
      delayMs: 1,
      expectedCommitSha: expectedHealth.commitSha,
      expectedDeployEnvironment: expectedHealth.deployEnvironment,
      fetcher: async () => {
        throw new Error("connection refused");
      },
      onProgress: (progress) => seen.push(progress),
      serviceUrl: "https://games.example.test",
      sleep: async () => {},
    }),
    /did not report commit/,
  );

  assert.deepEqual(
    seen.map((p) => `${p.attempt}/${p.attempts}:${p.state}`),
    ["1/3:unreachable", "2/3:unreachable", "3/3:unreachable"],
  );
});

test("waits ten minutes by default, not five", async () => {
  // The window that both observed failures ran out of was five minutes. Pin the new default so
  // it cannot quietly regress to a value a preview deploy outruns.
  let sleeps = 0;

  await assert.rejects(
    verifySlapChopHealth({
      expectedCommitSha: expectedHealth.commitSha,
      expectedDeployEnvironment: expectedHealth.deployEnvironment,
      fetcher: async () => ({ ok: false, status: 503 }),
      serviceUrl: "https://games.example.test",
      sleep: async () => {
        sleeps += 1;
      },
    }),
    (error) => {
      assert.match(error.message, /after 60 attempts over ~600s/);
      return true;
    },
  );

  assert.equal(sleeps, 59);
});
