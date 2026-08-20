import { pathToFileURL } from "node:url";

// 30 attempts at 10s gave a five-minute window, and a preview deploy does not reliably finish
// inside it. Two failures on consecutive commits of one PR branch exhausted it in different
// states -- once still serving the previous release, once with the service not yet routable at
// all (HTTP 404) -- and both times the deploy itself was fine, just slower than the poll. The
// deploy job allows 35 minutes, so ten is affordable and still bounded well inside it.
const DEFAULT_ATTEMPTS = 60;
const DEFAULT_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * What the last attempt saw, in the words of this script rather than the endpoint's.
 *
 * Kept as a small closed set so the failure can say which *kind* of wait ran out. "Never became
 * reachable" and "was reachable the whole time but never advanced to this release" have different
 * causes and different fixes, and the old message could not tell them apart.
 */
const STATE_HINTS = {
  "different release identifier":
    "the service answered but never advanced to this release -- the deploy is slower than this " +
    "poll window, or a newer deploy replaced it",
  "invalid health response":
    "the service answered but not with a Slap-Chop health payload -- check the route is the " +
    "health endpoint and the service is the one expected",
  unreachable:
    "no response at all -- the service never became routable, or the URL is wrong",
};

function hintFor(state) {
  if (STATE_HINTS[state]) return STATE_HINTS[state];
  if (state.startsWith("HTTP 404")) {
    return (
      "the URL 404ed every time -- the service or its domain was never routable in this " +
      "environment"
    );
  }
  if (state.startsWith("HTTP ")) {
    return "the service answered with an error status throughout";
  }
  return "";
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function healthEndpoint(serviceUrl) {
  const base = new URL(serviceUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("SLAP_CHOP_HEALTH_URL must use http or https");
  }
  return new URL("/api/health", base);
}

function asHealthResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload;
  if (
    typeof value.commitSha !== "string" ||
    typeof value.deployEnvironment !== "string" ||
    value.service !== "slap-chop-games" ||
    value.status !== "ok"
  ) {
    return null;
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifySlapChopHealth({
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  expectedCommitSha,
  expectedDeployEnvironment,
  fetcher = fetch,
  // Called once per attempt so a long wait is not a silent one. A ten-minute step that prints
  // nothing until it fails is indistinguishable from a hung step while it is running.
  onProgress = () => {},
  serviceUrl,
  sleep = delay,
}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }

  const endpoint = healthEndpoint(serviceUrl);
  let lastState = "unreachable";
  // How many attempts ended in each state. A run that 404s throughout and one that goes
  // 404 -> stale -> gives up look identical through `lastState` alone, and they are not the
  // same problem.
  const stateCounts = new Map();
  const recordState = (state) => {
    lastState = state;
    stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(endpoint, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        recordState(`HTTP ${response.status}`);
      } else {
        const health = asHealthResponse(await response.json());
        if (!health) {
          recordState("invalid health response");
        } else if (
          health.commitSha === expectedCommitSha &&
          health.deployEnvironment === expectedDeployEnvironment
        ) {
          return health;
        } else {
          // Do not print any value received from the endpoint. This runner only needs to prove
          // the expected release, and a compromised endpoint must not control workflow logs.
          recordState("different release identifier");
        }
      }
    } catch {
      recordState("unreachable");
    }

    onProgress({ attempt, attempts, state: lastState });
    if (attempt < attempts) await sleep(delayMs);
  }

  // Every part of this is either our own classification or a value we were given to check
  // against -- nothing received from the endpoint is echoed, so a compromised endpoint still
  // cannot write into the workflow log.
  const waitedSeconds = Math.round((attempts * delayMs) / 1000);
  const breakdown = [...stateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => `${state} x${count}`)
    .join(", ");
  const hint = hintFor(lastState);

  throw new Error(
    `Slap-Chop health endpoint did not report commit=${expectedCommitSha} ` +
      `environment=${expectedDeployEnvironment} after ${attempts} attempts over ~${waitedSeconds}s ` +
      `(last: ${lastState}; saw: ${breakdown})` +
      (hint ? `\n  ${hint}` : ""),
  );
}

async function main() {
  const health = await verifySlapChopHealth({
    expectedCommitSha: requiredEnvironment("EXPECTED_COMMIT_SHA"),
    expectedDeployEnvironment: requiredEnvironment(
      "EXPECTED_DEPLOY_ENVIRONMENT",
    ),
    // Every attempt would be one line for ten minutes, so report on the first and then
    // periodically -- enough to show the wait is progressing and what it is stuck on.
    onProgress: ({ attempt, attempts, state }) => {
      if (attempt === 1 || attempt % 6 === 0) {
        console.log(
          `waiting for the preview release: ${state} (${attempt}/${attempts})`,
        );
      }
    },
    serviceUrl: requiredEnvironment("SLAP_CHOP_HEALTH_URL"),
  });
  console.log(
    `Slap-Chop Games is serving ${health.commitSha} in ${health.deployEnvironment} (${health.service})`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Slap-Chop health verification failed",
    );
    process.exitCode = 1;
  });
}
