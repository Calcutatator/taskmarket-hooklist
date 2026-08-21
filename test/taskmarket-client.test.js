import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllPublicTasks, hydrateTaskHookFields } from "../lib/taskmarket-client.js";

const HOOK_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HOOK_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function taskId(number) {
  return `0x${number.toString(16).padStart(64, "0")}`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("paginates status=ALL and hydrates null list hook fields from task detail", async () => {
  const calls = [];
  const id1 = taskId(1);
  const id2 = taskId(2);
  const id3 = taskId(3);

  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);

    if (url.pathname.endsWith(`/tasks/${id1}`)) {
      return jsonResponse({ id: id1, hookContract: HOOK_A, hooks: [HOOK_B] });
    }
    if (url.pathname.endsWith(`/tasks/${id3}`)) {
      return jsonResponse({ id: id3, hookContract: { malformed: true }, hooks: [HOOK_A, null, "bad"] });
    }
    if (url.searchParams.get("cursor") === "next-page") {
      return jsonResponse({
        tasks: [{ id: id3, hookContract: null, hooks: null }],
        nextCursor: null,
        hasMore: false,
      });
    }
    return jsonResponse({
      tasks: [
        { id: id1, hookContract: null, hooks: null },
        { id: id2, hookContract: HOOK_B, hooks: null },
      ],
      nextCursor: "next-page",
      hasMore: true,
    });
  };

  const tasks = await fetchAllPublicTasks({
    apiBase: "https://example.test",
    fetchImpl,
    detailConcurrency: 2,
    detailCache: new Map(),
  });

  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].hookContract, HOOK_A);
  assert.deepEqual(tasks[0].hooks, [HOOK_B]);
  assert.equal(tasks[1].hookContract, HOOK_B);
  assert.deepEqual(tasks[2].hooks, [HOOK_A, null, "bad"]);

  const listCalls = calls.filter((url) => url.pathname === "/api/tasks");
  const detailCalls = calls.filter((url) => url.pathname !== "/api/tasks");
  assert.equal(listCalls.length, 2);
  assert.equal(detailCalls.length, 2);
  assert.equal(listCalls[0].searchParams.get("status"), "ALL");
  assert.equal(listCalls[0].searchParams.get("limit"), "100");
  assert.equal(listCalls[1].searchParams.get("cursor"), "next-page");
  assert.equal(detailCalls.some((url) => url.pathname.endsWith(`/tasks/${id2}`)), false);
});

test("detail hydration enforces bounded concurrency and reuses its cache", async () => {
  let active = 0;
  let maximumActive = 0;
  let detailCalls = 0;
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    id: taskId(index + 10),
    hookContract: null,
    hooks: null,
  }));
  const cache = new Map();
  const fetchImpl = async () => {
    detailCalls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return jsonResponse({ hookContract: HOOK_A, hooks: [] });
  };

  const first = await hydrateTaskHookFields(tasks, {
    apiBase: "https://example.test",
    fetchImpl,
    concurrency: 2,
    detailCache: cache,
  });
  const second = await hydrateTaskHookFields(tasks, {
    apiBase: "https://example.test",
    fetchImpl,
    concurrency: 2,
    detailCache: cache,
  });

  assert.equal(maximumActive, 2);
  assert.equal(detailCalls, 6);
  assert.equal(first.every((task) => task.hookContract === HOOK_A), true);
  assert.equal(second.every((task) => task.hookContract === HOOK_A), true);
});

test("rejects a pagination page that claims more data without a cursor", async () => {
  await assert.rejects(
    fetchAllPublicTasks({
      apiBase: "https://example.test",
      fetchImpl: async () => jsonResponse({ tasks: [], hasMore: true, nextCursor: null }),
      detailCache: new Map(),
    }),
    /without a next cursor/,
  );
});
