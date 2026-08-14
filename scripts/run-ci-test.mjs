import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const separator = process.argv.indexOf("--");
const label = process.argv[2];
const budgetSeconds = Number(process.argv[3]);
const command = separator === -1 ? [] : process.argv.slice(separator + 1);
const maximumBudgetSeconds = 300;

if (
  !label ||
  !Number.isFinite(budgetSeconds) ||
  budgetSeconds <= 0 ||
  budgetSeconds > maximumBudgetSeconds ||
  command.length === 0
) {
  console.error(
    `Usage: node scripts/run-ci-test.mjs <label> <budget-seconds (1-${maximumBudgetSeconds})> -- <command> [args...]`,
  );
  process.exit(2);
}

const startedAt = performance.now();
let timedOut = false;
let killTimer;

const child = spawn(command[0], command.slice(1), {
  detached: process.platform !== "win32",
  stdio: "inherit",
});

function signalChild(signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

const budgetTimer = setTimeout(() => {
  timedOut = true;
  console.error(
    `CI test shard budget exceeded: ${label} ran longer than ${budgetSeconds}s`,
  );
  signalChild("SIGTERM");
  killTimer = setTimeout(() => signalChild("SIGKILL"), 10_000);
  killTimer.unref();
}, budgetSeconds * 1000);
budgetTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => signalChild(signal));
}

child.once("error", (error) => {
  clearTimeout(budgetTimer);
  clearTimeout(killTimer);
  console.error(`Failed to start CI test shard ${label}:`, error);
  process.exitCode = 1;
});

child.once("exit", async (code, signal) => {
  clearTimeout(budgetTimer);
  clearTimeout(killTimer);

  const durationSeconds = (performance.now() - startedAt) / 1000;
  const status = timedOut
    ? "budget-exceeded"
    : code === 0
      ? "passed"
      : "failed";
  const summary = `| ${label} | ${durationSeconds.toFixed(1)}s | ${budgetSeconds}s | ${status} |`;

  console.log(`CI test benchmark: ${summary}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Five-minute test-shard benchmark\n\n| Shard | Duration | Budget | Status |\n| --- | ---: | ---: | --- |\n${summary}\n`,
    );
  }

  if (timedOut) {
    process.exitCode = 124;
  } else if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
