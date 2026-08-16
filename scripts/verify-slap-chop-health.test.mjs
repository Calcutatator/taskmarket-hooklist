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
