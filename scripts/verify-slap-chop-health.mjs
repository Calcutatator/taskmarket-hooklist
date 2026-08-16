import { pathToFileURL } from "node:url";

const DEFAULT_ATTEMPTS = 30;
const DEFAULT_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

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
  serviceUrl,
  sleep = delay,
}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }

  const endpoint = healthEndpoint(serviceUrl);
  let lastState = "unreachable";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(endpoint, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        lastState = `HTTP ${response.status}`;
      } else {
        const health = asHealthResponse(await response.json());
        if (!health) {
          lastState = "invalid health response";
        } else if (
          health.commitSha === expectedCommitSha &&
          health.deployEnvironment === expectedDeployEnvironment
        ) {
          return health;
        } else {
          // Do not print any value received from the endpoint. This runner only needs to prove
          // the expected release, and a compromised endpoint must not control workflow logs.
          lastState = "different release identifier";
        }
      }
    } catch {
      lastState = "unreachable";
    }

    if (attempt < attempts) await sleep(delayMs);
  }

  throw new Error(
    `Slap-Chop health endpoint did not report commit=${expectedCommitSha} environment=${expectedDeployEnvironment} (last: ${lastState})`,
  );
}

async function main() {
  const health = await verifySlapChopHealth({
    expectedCommitSha: requiredEnvironment("EXPECTED_COMMIT_SHA"),
    expectedDeployEnvironment: requiredEnvironment(
      "EXPECTED_DEPLOY_ENVIRONMENT",
    ),
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
