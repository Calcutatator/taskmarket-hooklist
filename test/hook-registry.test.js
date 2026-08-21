import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateHooks,
  buildRegistry,
  extractTaskHookAddresses,
  normalizeHookAddress,
} from "../lib/hook-registry.js";

const HOOK_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HOOK_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REQUESTER_A = "0x1111111111111111111111111111111111111111";
const REQUESTER_B = "0x2222222222222222222222222222222222222222";

function taskId(number) {
  return `0x${number.toString(16).padStart(64, "0")}`;
}

function task(number, overrides = {}) {
  return {
    id: taskId(number),
    taskVisibility: "public",
    requester: REQUESTER_A,
    description: `# Task ${number}\nDetails`,
    createdAt: `2026-08-${String(number).padStart(2, "0")}T12:00:00.000Z`,
    status: "open",
    mode: "bounty",
    tags: ["AI"],
    hookContract: null,
    hooks: [],
    ...overrides,
  };
}

test("normalizes strict EVM hook addresses", () => {
  assert.equal(normalizeHookAddress(`  ${HOOK_A.toUpperCase().replace("0X", "0x")}  `), HOOK_A);
  assert.equal(normalizeHookAddress("0x1234"), null);
  assert.equal(normalizeHookAddress(null), null);
  assert.equal(normalizeHookAddress({ address: HOOK_A }), null);
});

test("extracts and deduplicates hookContract and hooks without trusting malformed values", () => {
  assert.deepEqual(extractTaskHookAddresses({
    hookContract: HOOK_A.toUpperCase().replace("0X", "0x"),
    hooks: [HOOK_A, HOOK_B, null, 42, "not-an-address", HOOK_B.toUpperCase().replace("0X", "0x")],
  }), [HOOK_A, HOOK_B]);
  assert.deepEqual(extractTaskHookAddresses({ hookContract: {}, hooks: "not-an-array" }), []);
  assert.deepEqual(extractTaskHookAddresses(null), []);
});

test("aggregates public task usage, activity, requesters, filters, and examples", () => {
  const tasks = [
    task(1, {
      hookContract: HOOK_A.toUpperCase().replace("0X", "0x"),
      hooks: [HOOK_A, HOOK_B],
      tags: ["AI", "security", "AI"],
    }),
    task(2, {
      hooks: [HOOK_A],
      status: "completed",
      mode: "claim",
      requester: REQUESTER_B,
      tags: ["Automation"],
    }),
    task(3, {
      hookContract: HOOK_A,
      status: "claimed",
      mode: "pitch",
      requester: REQUESTER_B.toUpperCase().replace("0X", "0x"),
    }),
    task(4, {
      hooks: [HOOK_A, "malformed"],
      status: "cancelled",
      tags: null,
    }),
    task(5),
    task(2, { hookContract: HOOK_B }),
    task(6, { hookContract: HOOK_B, taskVisibility: "unlisted" }),
    null,
  ];
  const curatedMetadata = [{
    address: HOOK_A,
    chainId: 8453,
    name: "Proof Hook",
    description: "Checks a task proof.",
    author: "Task author",
    repository: "https://github.com/example/proof-hook",
    homepage: null,
    license: "MIT",
    categories: ["Verification", "security"],
    verified: true,
    auditUrl: null,
    sourceUrl: "https://github.com/example/proof-hook/blob/main/src/Hook.sol",
    currentDefault: true,
    defaultStatus: "current_confirmed",
    proxyKind: "erc1967",
    implementationAddress: HOOK_B,
    proxySourceVerified: true,
  }];

  const result = aggregateHooks(tasks, { curatedMetadata });
  assert.equal(result.totalTasksScanned, 5);
  assert.equal(result.totalHooks, 2);

  const hookA = result.hooks.find((hook) => hook.address === HOOK_A);
  assert.deepEqual(hookA, {
    address: HOOK_A,
    chainId: 8453,
    name: "Proof Hook",
    description: "Checks a task proof.",
    author: "Task author",
    repository: "https://github.com/example/proof-hook",
    homepage: null,
    license: "MIT",
    categories: ["security", "verification"],
    verified: true,
    auditUrl: null,
    sourceUrl: "https://github.com/example/proof-hook/blob/main/src/Hook.sol",
    currentDefault: true,
    defaultStatus: "current_confirmed",
    proxyKind: "erc1967",
    implementationAddress: HOOK_B,
    proxySourceVerified: true,
    taskCount: 4,
    usageCount: 4,
    activeTaskCount: 2,
    modes: ["bounty", "claim", "pitch"],
    statuses: ["cancelled", "claimed", "completed", "open"],
    tags: ["ai", "automation", "security"],
    requesterCount: 2,
    firstSeen: "2026-08-01T12:00:00.000Z",
    lastSeen: "2026-08-04T12:00:00.000Z",
    exampleTasks: [
      { id: taskId(4), title: "Task 4", status: "cancelled", mode: "bounty" },
      { id: taskId(3), title: "Task 3", status: "claimed", mode: "pitch" },
      { id: taskId(2), title: "Task 2", status: "completed", mode: "claim" },
    ],
  });

  const hookB = result.hooks.find((hook) => hook.address === HOOK_B);
  assert.equal(hookB.taskCount, 1);
  assert.equal(hookB.name, null);
  assert.deepEqual(hookB.categories, []);
  assert.equal(hookB.currentDefault, false);
  assert.equal(hookB.defaultStatus, "unknown");
  assert.equal(hookB.proxyKind, "unknown");
  assert.equal(hookB.implementationAddress, null);
  assert.equal(hookB.proxySourceVerified, false);
});

test("buildRegistry emits the stable top-level API contract", () => {
  const registry = buildRegistry([task(1, { hookContract: HOOK_A })], {
    generatedAt: "2026-08-21T10:00:00.000Z",
    source: "https://api.taskmarket.dev/api/tasks?status=ALL",
  });
  assert.deepEqual(Object.keys(registry), [
    "generatedAt",
    "source",
    "chainId",
    "totalTasksScanned",
    "totalHooks",
    "hooks",
  ]);
  assert.equal(registry.chainId, 8453);
  assert.equal(registry.totalTasksScanned, 1);
  assert.equal(registry.totalHooks, 1);
});
