// Decides an aggregate gate: `quality` or `ui`.
//
// Both gates read the same job table, so the six jobs they have in common are described once
// instead of being maintained as two hand-written lists that can disagree.
//
// A job with no condition must succeed. A conditional job may skip only when the change detector
// succeeded and the output named in that job's own `if:` says it was irrelevant -- and must have
// run when that output says it was relevant. Every job is reported, so one run names every
// failure rather than stopping at the first.
//
// Usage:
//   NEEDS='<toJSON(needs)>' node scripts/verify-ci-gate.mjs --gate quality
//   node scripts/verify-ci-gate.mjs --check-workflow .github/workflows/ci.yml
//
// Exit codes:
//   1  a job failed, or a skip was not authorised
//   2  invalid invocation, or ci.yml no longer matches this file

import { appendFile, readFile } from "node:fs/promises";

const DETECTOR = "changes";
const ALWAYS = null;

const JOBS = {
  changes: ALWAYS,
  "skill-conformance": ALWAYS,
  adr: ALWAYS,
  "quality-js": "needs.changes.outputs.quality_js == 'true'",
  "backend-tests": "needs.changes.outputs.backend == 'true'",
  "js-tests-web": "needs.changes.outputs.web == 'true'",
  "js-tests-other": "needs.changes.outputs.other == 'true'",
  "web-build": "needs.changes.outputs.web == 'true'",
  "quality-contracts": "needs.changes.outputs.contracts == 'true'",
  storybook: "needs.changes.outputs.web == 'true'",
  "slap-chop-games": "needs.changes.outputs.slap_chop == 'true'",
  "ui-e2e": "needs.changes.outputs.web == 'true'",
};

const GATES = {
  quality: [
    "quality-js",
    "backend-tests",
    "js-tests-web",
    "js-tests-other",
    "web-build",
    "changes",
    "quality-contracts",
    "skill-conformance",
    "adr",
    "storybook",
    "slap-chop-games",
  ],
  ui: [
    "quality-js",
    "backend-tests",
    "js-tests-web",
    "js-tests-other",
    "web-build",
    "changes",
    "storybook",
    "slap-chop-games",
    "ui-e2e",
  ],
};

// The only condition shape this understands. Anything else is refused rather than guessed at: a
// condition the gate cannot read is a condition it cannot enforce.
const CONDITION =
  /^needs\.changes\.outputs\.([A-Za-z_][A-Za-z0-9_]*) == 'true'$/;

function outputKey(condition) {
  const match = CONDITION.exec(condition);
  if (!match) {
    throw new Error(`Cannot authorise a skip for condition: ${condition}`);
  }
  return match[1];
}

function invalid(message) {
  console.error(message);
  process.exit(2);
}

async function writeSummary(gate, rows) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const table = [
    `## ${gate}`,
    "",
    "| Job | Result | Verdict |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| \`${r.job}\` | ${r.result} | ${r.verdict} |`),
    "",
  ].join("\n");
  try {
    await appendFile(summaryPath, table);
  } catch {
    // The table is a report. Losing it must not change whether the gate passes.
  }
}

async function verifyGate(gate) {
  const members = GATES[gate];
  if (!members) invalid(`Unknown gate: ${gate}`);
  if (!process.env.NEEDS) {
    invalid("NEEDS is required: pass ${{ toJSON(needs) }}");
  }

  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS);
  } catch (error) {
    invalid(`NEEDS is not valid JSON: ${error.message}`);
  }

  const conditional = members.filter((job) => JOBS[job] !== ALWAYS);
  const rows = [];
  let failed = false;
  let outputs = {};

  // Only a gate with a conditional member has to interpret a skip, and only that gate needs the
  // detector. Requiring it everywhere would make `ui` depend on a job it has no use for.
  if (conditional.length > 0) {
    const detector = needs[DETECTOR]?.result;
    if (detector !== "success") {
      console.log(
        `FAILED   ${DETECTOR} (${detector ?? "absent"}) -- no skip can be explained, failing closed`,
      );
      await writeSummary(gate, [
        {
          job: DETECTOR,
          result: detector ?? "absent",
          verdict: "failing closed",
        },
      ]);
      process.exit(1);
    }
    outputs = needs[DETECTOR].outputs ?? {};
  }

  for (const job of members) {
    if (job === DETECTOR && conditional.length > 0) {
      console.log(`ok       ${job} (success)`);
      rows.push({ job, result: "success", verdict: "ok" });
      continue;
    }

    const result = needs[job]?.result;
    if (result === undefined) {
      console.log(
        `FAILED   ${job} (absent) -- the gate does not list it in needs`,
      );
      rows.push({ job, result: "absent", verdict: "not in needs" });
      failed = true;
      continue;
    }

    const condition = JOBS[job];
    if (condition === ALWAYS) {
      if (result === "success") {
        console.log(`ok       ${job} (${result})`);
        rows.push({ job, result, verdict: "ok" });
      } else {
        console.log(`FAILED   ${job} (${result})`);
        rows.push({ job, result, verdict: "must always run" });
        failed = true;
      }
      continue;
    }

    const key = outputKey(condition);
    if (!(key in outputs)) {
      // toJSON(needs) is expected to carry the detector's outputs. Without them every conditional
      // job would look irrelevant and the gate would pass having checked nothing.
      invalid(
        `Detector output '${key}' missing from NEEDS; cannot authorise ${job}`,
      );
    }

    const expected = outputs[key] === "true" ? "success" : "skipped";
    if (result === expected) {
      console.log(`ok       ${job} (${result})`);
      rows.push({ job, result, verdict: "ok" });
    } else {
      console.log(
        `FAILED   ${job} (${result}, ${key}=${outputs[key]} so expected ${expected})`,
      );
      rows.push({ job, result, verdict: `expected ${expected}` });
      failed = true;
    }
  }

  await writeSummary(gate, rows);
  process.exit(failed ? 1 : 0);
}

function parseWorkflow(source) {
  const jobs = new Map();
  const needs = new Map();
  let inJobs = false;
  let current = null;
  let collecting = null;

  for (const line of source.split("\n")) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) {
      current = job[1];
      jobs.set(current, ALWAYS);
      collecting = null;
      continue;
    }
    if (!current) continue;

    if (collecting) {
      if (/^ {6}\]\s*$/.test(line)) {
        collecting = null;
        continue;
      }
      const item = /^ {8}([A-Za-z0-9_-]+),?\s*$/.exec(line);
      if (item) {
        needs.get(current).push(item[1]);
        continue;
      }
      if (/^ {6}\[\s*$/.test(line)) continue;
      collecting = null;
    }

    // Prettier wraps a long flow sequence across lines, so both forms occur in this file.
    const inline = /^ {4}needs:\s*\[(.+)\]\s*$/.exec(line);
    if (inline) {
      needs.set(
        current,
        inline[1].split(",").map((n) => n.trim()),
      );
      continue;
    }
    const single = /^ {4}needs:\s*([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (single) {
      needs.set(current, [single[1]]);
      continue;
    }
    if (/^ {4}needs:\s*$/.test(line)) {
      needs.set(current, []);
      collecting = current;
      continue;
    }

    const condition = /^ {4}if: (.+?)\s*$/.exec(line);
    if (condition) jobs.set(current, condition[1]);
  }

  return { jobs, needs };
}

async function checkWorkflow(path) {
  const { jobs, needs } = parseWorkflow(await readFile(path, "utf8"));
  const problems = [];
  const gateNames = Object.keys(GATES);

  for (const gate of gateNames) {
    if (!jobs.has(gate))
      invalid(`No '${gate}' job in ${path}; this reader needs updating`);
    jobs.delete(gate);
  }

  const covered = new Set(gateNames.flatMap((gate) => GATES[gate]));

  for (const [job, condition] of jobs) {
    if (!(job in JOBS)) {
      problems.push(`${job} is in ${path} but not in JOBS`);
      continue;
    }
    if (JOBS[job] !== condition) {
      problems.push(
        `${job} has if: ${condition ?? "(none)"}, JOBS says ${JOBS[job] ?? "(none)"}`,
      );
    }
    if (!covered.has(job)) {
      problems.push(
        `${job} is in no gate, so neither required check would notice it fail`,
      );
    }
  }

  for (const job of Object.keys(JOBS)) {
    if (!jobs.has(job)) problems.push(`${job} is in JOBS but not in ${path}`);
  }

  for (const gate of gateNames) {
    const declared = [...(needs.get(gate) ?? [])].sort();
    const expected = [...GATES[gate]].sort();
    if (declared.join(",") !== expected.join(",")) {
      problems.push(
        `${gate} needs [${declared.join(", ")}] but GATES says [${expected.join(", ")}]`,
      );
    }
    // A gate that has to interpret a skip needs the detector's outputs to interpret it with.
    const conditional = GATES[gate].some((job) => JOBS[job] !== ALWAYS);
    if (conditional && !GATES[gate].includes(DETECTOR)) {
      problems.push(
        `${gate} has a conditional job but does not depend on ${DETECTOR}`,
      );
    }
  }

  for (const condition of Object.values(JOBS)) {
    if (condition !== ALWAYS) outputKey(condition);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAILED   ${problem}`);
    process.exit(2);
  }
  console.log(`ok       ${path} matches JOBS and GATES (${jobs.size} jobs)`);
}

const [flag, value] = process.argv.slice(2);
if (flag === "--check-workflow") {
  if (!value)
    invalid("Usage: node scripts/verify-ci-gate.mjs --check-workflow <path>");
  await checkWorkflow(value);
} else if (flag === "--gate") {
  if (!value)
    invalid("Usage: node scripts/verify-ci-gate.mjs --gate <quality|ui>");
  await verifyGate(value);
} else {
  invalid("Usage: node scripts/verify-ci-gate.mjs --gate <quality|ui>");
}
