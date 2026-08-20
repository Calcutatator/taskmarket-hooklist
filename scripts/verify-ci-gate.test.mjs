import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const gate = join(import.meta.dirname, "verify-ci-gate.mjs");
const workflow = join(
  import.meta.dirname,
  "..",
  ".github",
  "workflows",
  "ci.yml",
);

function run(args, needs) {
  const env = { ...process.env, GITHUB_STEP_SUMMARY: "" };
  if (needs !== undefined) env.NEEDS = JSON.stringify(needs);
  else env.NEEDS = "";
  return spawnSync(process.execPath, [gate, ...args], {
    env,
    encoding: "utf8",
  });
}

const ALWAYS_JOBS = [
  "skill-conformance",
  "adr",
  "quality-js",
  "backend-tests",
  "js-tests",
  "web-build",
  "storybook",
  "slap-chop-games",
  "ui-e2e",
];

// A run where contracts changed and every job passed.
function allGreen(overrides = {}) {
  const needs = {
    changes: { result: "success", outputs: { contracts: "true" } },
    "quality-contracts": { result: "success" },
  };
  for (const job of ALWAYS_JOBS) needs[job] = { result: "success" };
  return { ...needs, ...overrides };
}

test("both gates pass when every job succeeded", () => {
  assert.equal(run(["--gate", "quality"], allGreen()).status, 0);
  assert.equal(run(["--gate", "ui"], allGreen()).status, 0);
});

test("rejects an unknown or missing gate", () => {
  assert.equal(run(["--gate", "nope"], allGreen()).status, 2);
  assert.equal(run([], allGreen()).status, 2);
});

test("rejects a missing or unparseable NEEDS", () => {
  assert.equal(run(["--gate", "quality"]).status, 2);
  const bad = spawnSync(process.execPath, [gate, "--gate", "quality"], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: "", NEEDS: "{" },
    encoding: "utf8",
  });
  assert.equal(bad.status, 2);
});

test("names every failing job instead of stopping at the first", () => {
  const result = run(
    ["--gate", "quality"],
    allGreen({ adr: { result: "failure" }, storybook: { result: "failure" } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAILED\s+adr/);
  assert.match(result.stdout, /FAILED\s+storybook/);
});

for (const result of ["failure", "cancelled", "timed_out", "skipped"]) {
  test(`rejects an unconditional job reporting ${result}`, () => {
    const run1 = run(
      ["--gate", "quality"],
      allGreen({ "web-build": { result } }),
    );
    assert.equal(run1.status, 1);
    assert.match(run1.stdout, /must always run|FAILED\s+web-build/);
  });
}

test("accepts a contracts skip the detector authorised", () => {
  const needs = allGreen({
    changes: { result: "success", outputs: { contracts: "false" } },
    "quality-contracts": { result: "skipped" },
  });
  assert.equal(run(["--gate", "quality"], needs).status, 0);
});

test("rejects a contracts skip the detector said was relevant", () => {
  const needs = allGreen({ "quality-contracts": { result: "skipped" } });
  const result = run(["--gate", "quality"], needs);
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /quality-contracts \(skipped, contracts=true so expected success\)/,
  );
});

test("rejects a contracts run the detector said was irrelevant", () => {
  const needs = allGreen({
    changes: { result: "success", outputs: { contracts: "false" } },
  });
  const result = run(["--gate", "quality"], needs);
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /quality-contracts \(success, contracts=false so expected skipped\)/,
  );
});

test("fails closed when the detector did not succeed", () => {
  const needs = allGreen({
    changes: { result: "failure", outputs: {} },
    "quality-contracts": { result: "skipped" },
  });
  const result = run(["--gate", "quality"], needs);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /failing closed/);
});

test("refuses to decide when the detector outputs are absent", () => {
  const needs = allGreen({ changes: { result: "success" } });
  const result = run(["--gate", "quality"], needs);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /'contracts' missing from NEEDS/);
});

// `ui` has no conditional member, so it must not require the detector it does not depend on.
test("the ui gate decides without the detector", () => {
  const needs = allGreen();
  delete needs.changes;
  delete needs["quality-contracts"];
  assert.equal(run(["--gate", "ui"], needs).status, 0);
});

test("rejects a job the gate does not list in needs", () => {
  const needs = allGreen();
  delete needs["slap-chop-games"];
  const result = run(["--gate", "ui"], needs);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /does not list it in needs/);
});

test("accepts ci.yml as committed", () => {
  const result = run(["--check-workflow", workflow]);
  assert.equal(result.status, 0, result.stderr);
});

function checkMutated(mutate) {
  const directory = mkdtempSync(join(tmpdir(), "ci-gate-"));
  const copy = join(directory, "ci.yml");
  writeFileSync(copy, mutate(readFileSync(workflow, "utf8")));
  try {
    return run(["--check-workflow", copy]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("rejects a job neither gate knows about", () => {
  const result = checkMutated((yaml) =>
    yaml.replace(
      "  adr:\n",
      "  new-audit:\n    runs-on: ubuntu-latest\n\n  adr:\n",
    ),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /new-audit/);
});

test("rejects a condition that no longer matches the mapping", () => {
  const result = checkMutated((yaml) =>
    yaml.replace(
      "    if: needs.changes.outputs.contracts == 'true'",
      "    if: needs.changes.outputs.web == 'true'",
    ),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /quality-contracts has if:/);
});

test("rejects a gate whose needs no longer match GATES", () => {
  const result = checkMutated((yaml) =>
    yaml.replace("        slap-chop-games,\n      ]", "      ]"),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs \[.*\] but GATES says/);
});
