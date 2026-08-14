import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runner = join(import.meta.dirname, "run-ci-test.mjs");

function run(label, budgetSeconds, childSource, env = process.env) {
  return spawnSync(
    process.execPath,
    [
      runner,
      label,
      String(budgetSeconds),
      "--",
      process.execPath,
      "-e",
      childSource,
    ],
    {
      encoding: "utf8",
      env,
      timeout: 5_000,
    },
  );
}

test("reports a passing benchmark", () => {
  const result = run("passing-shard", 1, "process.exit(0)");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /passing-shard .* passed/);
});

test("propagates a child failure", () => {
  const result = run("failing-shard", 1, "process.exit(7)");

  assert.equal(result.status, 7);
  assert.match(result.stdout, /failing-shard .* failed/);
});

test("terminates a shard that exceeds its budget", () => {
  const result = run("slow-shard", 0.05, "setInterval(() => {}, 1_000)");

  assert.equal(result.status, 124);
  assert.match(result.stderr, /CI test shard budget exceeded/);
  assert.match(result.stdout, /slow-shard .* budget-exceeded/);
});

test("rejects a budget above five minutes", () => {
  const result = run("over-budget-shard", 301, "process.exit(0)");

  assert.equal(result.status, 2);
  assert.match(result.stderr, /budget-seconds \(1-300\)/);
  assert.doesNotMatch(result.stdout, /over-budget-shard/);
});

test("writes the benchmark to the GitHub step summary", () => {
  const directory = mkdtempSync(join(tmpdir(), "taskmarket-ci-benchmark-"));
  const summaryPath = join(directory, "summary.md");

  try {
    const result = run("summary-shard", 1, "process.exit(0)", {
      ...process.env,
      GITHUB_STEP_SUMMARY: summaryPath,
    });

    assert.equal(result.status, 0);
    assert.match(
      readFileSync(summaryPath, "utf8"),
      /Five-minute test-shard benchmark/,
    );
    assert.match(readFileSync(summaryPath, "utf8"), /summary-shard .* passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
