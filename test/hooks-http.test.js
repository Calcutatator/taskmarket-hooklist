import assert from "node:assert/strict";
import test from "node:test";
import { handleHooksRequest, HOOKS_CACHE_CONTROL } from "../lib/hooks-http.js";

function responseRecorder() {
  return {
    headers: new Map(),
    statusCode: 0,
    body: null,
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
    },
    end(body) {
      this.body = body;
    },
  };
}

test("serves the stable registry with shared cache headers", async () => {
  const response = responseRecorder();
  const registry = {
    generatedAt: "2026-08-21T10:00:00.000Z",
    source: "https://api.taskmarket.dev/api/tasks?status=ALL",
    chainId: 8453,
    totalTasksScanned: 0,
    totalHooks: 0,
    hooks: [],
  };
  await handleHooksRequest({ method: "GET" }, response, { getRegistry: async () => registry });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("cache-control"), HOOKS_CACHE_CONTROL);
  assert.deepEqual(JSON.parse(response.body), registry);
});

test("returns a stable public error without leaking upstream details", async () => {
  const response = responseRecorder();
  await handleHooksRequest({ method: "GET" }, response, {
    getRegistry: async () => { throw new Error("secret upstream detail"); },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), {
    error: "HOOK_REGISTRY_UNAVAILABLE",
    message: "The public hook registry is temporarily unavailable.",
  });
  assert.equal(response.body.includes("secret"), false);
});
