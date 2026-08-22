import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
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

const ALWAYS_JOBS = ["adr"];

// Conditional job -> the detector output that authorises it.
const CONDITIONAL_JOBS = {
  "quality-contracts": "contracts",
  "backend-tests": "backend",
  "web-build": "web",
  storybook: "web",
  "slap-chop-games": "slap_chop",
  "ui-e2e": "web",
  "quality-js": "quality_js",
  "js-tests-web": "web",
  "js-tests-other": "other",
  "skill-conformance": "skill",
};

const BASE_OUTPUTS = {
  contracts: "true",
  web: "true",
  backend: "true",
  slap_chop: "true",
  skill: "true",
  quality_js: "true",
  other: "true",
};

// A run where every detector output is relevant and every job passed.
function allGreen(overrides = {}) {
  const needs = {
    changes: { result: "success", outputs: { ...BASE_OUTPUTS } },
  };
  for (const job of ALWAYS_JOBS) needs[job] = { result: "success" };
  for (const job of Object.keys(CONDITIONAL_JOBS))
    needs[job] = { result: "success" };
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
    const run1 = run(["--gate", "quality"], allGreen({ adr: { result } }));
    assert.equal(run1.status, 1);
    assert.match(run1.stdout, /must always run|FAILED\s+adr/);
  });
}

// Every conditional job gets the same coverage instead of writing this five times -- one per
// entry in CONDITIONAL_JOBS -- so a new conditional job is exercised the moment it is added there.
// Picks any one gate each job is actually a member of (most are members of both).
for (const [job, key] of Object.entries(CONDITIONAL_JOBS)) {
  const gate = job === "ui-e2e" ? "ui" : "quality";

  test(`accepts a ${job} skip the detector authorised`, () => {
    // Every job keyed on the same detector output must skip together, or a same-key sibling
    // still expecting success (e.g. storybook and ui-e2e both key on `web`) fails the gate.
    const siblingOverrides = Object.fromEntries(
      Object.entries(CONDITIONAL_JOBS)
        .filter(([, k]) => k === key)
        .map(([j]) => [j, { result: "skipped" }]),
    );
    const needs = allGreen({
      changes: {
        result: "success",
        outputs: { ...BASE_OUTPUTS, [key]: "false" },
      },
      ...siblingOverrides,
    });
    assert.equal(run(["--gate", gate], needs).status, 0);
  });

  test(`rejects a ${job} skip the detector said was relevant`, () => {
    const needs = allGreen({ [job]: { result: "skipped" } });
    const result = run(["--gate", gate], needs);
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      new RegExp(`${job} \\(skipped, ${key}=true so expected success\\)`),
    );
  });

  test(`rejects a ${job} run the detector said was irrelevant`, () => {
    const needs = allGreen({
      changes: {
        result: "success",
        outputs: { ...BASE_OUTPUTS, [key]: "false" },
      },
    });
    const result = run(["--gate", gate], needs);
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      new RegExp(`${job} \\(success, ${key}=false so expected skipped\\)`),
    );
  });
}

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
  assert.match(result.stderr, /missing from NEEDS/);
});

// Both gates now have conditional members (quality: quality-contracts; ui: web-build,
// storybook, slap-chop-games, ui-e2e), so both must fail closed without the detector.
test("both gates fail closed without the detector", () => {
  for (const g of ["quality", "ui"]) {
    const needs = allGreen();
    delete needs.changes;
    const result = run(["--gate", g], needs);
    assert.equal(result.status, 1, `gate ${g}`);
    assert.match(result.stdout, /failing closed/);
  }
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

function changeDetectorScript() {
  const source = readFileSync(workflow, "utf8");
  const detector = source.match(
    /      - id: filter\n        run: \|\n([\s\S]*?)\n  skill-conformance:/,
  )?.[1];
  assert.ok(detector, "changes.filter step not found");
  return detector
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .replaceAll("${{ github.event_name }}", "push")
    .replaceAll("${{ github.base_ref }}", "");
}

function git(directory, ...args) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function runChangeDetector(makefileBefore, makefileAfter, lockfileAfter) {
  const directory = mkdtempSync(join(tmpdir(), "ci-change-detector-"));
  const workflowCopy = join(directory, ".github", "workflows", "ci.yml");
  const output = join(directory, "github-output");
  mkdirSync(join(directory, ".github", "workflows"), { recursive: true });
  writeFileSync(workflowCopy, readFileSync(workflow, "utf8"));
  writeFileSync(join(directory, "Makefile"), makefileBefore);
  writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  try {
    git(directory, "init", "-q");
    git(directory, "config", "user.name", "CI Detector Test");
    git(directory, "config", "user.email", "ci-detector@example.test");
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");
    writeFileSync(join(directory, "Makefile"), makefileAfter);
    if (lockfileAfter !== undefined)
      writeFileSync(join(directory, "pnpm-lock.yaml"), lockfileAfter);
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "change");

    const script = [
      `pnpm() { printf '%s\\n' '{"packages":["//"]}'; }`,
      changeDetectorScript(),
    ].join("\n");
    const result = spawnSync("/bin/bash", ["-c", script], {
      cwd: directory,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);

    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("contracts detector follows only its relevant standalone Makefile target", () => {
  const before = [
    "SHELL := /bin/bash",
    "# unchanged shared header 01",
    "# unchanged shared header 02",
    "# unchanged shared header 03",
    "# unchanged shared header 04",
    "# unchanged shared header 05",
    "# unchanged shared header 06",
    "# unchanged shared header 07",
    "# unchanged shared header 08",
    "# unchanged shared header 09",
    "# unchanged shared header 10",
    "# unchanged shared header 11",
    "# unchanged shared header 12",
    "# unchanged shared header 13",
    "",
    "hook-manifest-schema-drift:",
    "\t@echo old schema check",
    "",
    "unrelated:",
    "\t@echo old unrelated target",
    "",
  ].join("\n");

  const hookTargetChanged = runChangeDetector(
    before,
    before.replace("old schema check", "new schema check"),
  );
  assert.equal(hookTargetChanged.contracts, "true");
  assert.equal(hookTargetChanged.quality_js, "false");
  assert.equal(hookTargetChanged.other, "false");

  const unrelatedTargetChanged = runChangeDetector(
    before,
    before.replace("old unrelated target", "new unrelated target"),
  );
  assert.equal(unrelatedTargetChanged.contracts, "false");
  assert.equal(unrelatedTargetChanged.quality_js, "false");
  assert.equal(unrelatedTargetChanged.other, "false");
});

test("contracts detector selects a root lockfile-only change", () => {
  const output = runChangeDetector(
    "SHELL := /bin/bash\n",
    "SHELL := /bin/bash\n",
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n",
  );
  assert.equal(output.contracts, "true");
});

test("broad JS detectors keep Turbo's root pseudo-package excluded", () => {
  const source = readFileSync(workflow, "utf8");
  assert.match(
    source,
    /any_affected_outside "@taskmarket\/contracts" "@taskmarket\/docs" "@taskmarket\/web" "\/\/" && QUALITY_JS=true/,
  );
  assert.match(
    source,
    /any_affected_outside "@taskmarket\/contracts" "@taskmarket\/docs" "@taskmarket\/backend" "@taskmarket\/web" "\/\/" && OTHER=true/,
  );
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
