import assert from "node:assert/strict";
import test from "node:test";
import { loadCuratedHookMetadata } from "../lib/curated-hooks.js";
import { buildRegistry } from "../lib/hook-registry.js";
import {
  assertValidCuratedHook,
  assertValidRegistry,
  validateRegistry,
} from "../lib/registry-validation.js";

const HOOK = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TASK_ID = `0x${"1".padStart(64, "0")}`;

function validRegistry() {
  return buildRegistry([{
    id: TASK_ID,
    requester: "0x1111111111111111111111111111111111111111",
    taskVisibility: "public",
    description: "A hooked task",
    createdAt: "2026-08-20T10:00:00.000Z",
    status: "open",
    mode: "bounty",
    tags: ["hooks"],
    hookContract: HOOK,
    hooks: null,
  }], {
    generatedAt: "2026-08-21T10:00:00.000Z",
    source: "https://api.taskmarket.dev/api/tasks?status=ALL",
  });
}

test("accepts a generated registry and the checked-in grounded metadata records", async () => {
  assert.equal(assertValidRegistry(validRegistry()).totalHooks, 1);
  const metadata = await loadCuratedHookMetadata();
  assert.equal(metadata.length, 3);
  assert.deepEqual(metadata.map((hook) => hook.address), [
    "0x1bc1874271a7ec2b1bcda431ac7aa5d1df17e95b",
    "0x8e28bb2c54443f54030ff9f2bc1f1794c017f0ca",
    "0xbfbdac915585972e7953f258c0b93a07bc7f951a",
  ]);
  assert.equal(metadata.find((hook) => hook.currentDefault).proxyKind, "erc1967");
});

test("reports structural and cross-field registry errors", () => {
  const registry = validRegistry();
  registry.totalHooks = 2;
  registry.hooks[0].address = registry.hooks[0].address.toUpperCase().replace("0X", "0x");
  registry.hooks[0].activeTaskCount = 4;
  registry.hooks[0].proxyKind = "transparent";
  registry.hooks[0].exampleTasks.push(
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `0x${String(index + 2).padStart(64, "0")}`,
      title: "Extra",
      status: "open",
      mode: "bounty",
    })),
  );

  const result = validateRegistry(registry);
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.includes("totalHooks")), true);
  assert.equal(result.errors.some((error) => error.includes("lowercase EVM address")), true);
  assert.equal(result.errors.some((error) => error.includes("activeTaskCount")), true);
  assert.equal(result.errors.some((error) => error.includes("proxyKind")), true);
  assert.equal(result.errors.some((error) => error.includes("more than 3")), true);
});

test("validates canonical curated hook metadata", () => {
  assert.doesNotThrow(() => assertValidCuratedHook({
    address: HOOK,
    chainId: 8453,
    name: "Example",
    categories: ["security", "verification"],
    verified: false,
    repository: "https://github.com/example/hook",
    currentDefault: false,
    defaultStatus: "custom",
    proxyKind: "none",
    implementationAddress: null,
    proxySourceVerified: false,
  }));
  assert.throws(() => assertValidCuratedHook({
    address: HOOK.toUpperCase().replace("0X", "0x"),
    chainId: 1,
  }), /Invalid curated metadata/);
});
