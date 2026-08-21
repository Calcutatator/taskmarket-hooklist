import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCuratedHookMetadata } from "./curated-hooks.js";
import { buildRegistry, TASKMARKET_API_BASE } from "./hook-registry.js";
import { assertValidRegistry } from "./registry-validation.js";
import { fetchAllPublicTasks, taskmarketTasksSource } from "./taskmarket-client.js";

const defaultFallbackPath = fileURLToPath(new URL("../public/registry.json", import.meta.url));

export class RegistryUnavailableError extends Error {
  constructor(message = "The hook registry is temporarily unavailable.", { cause } = {}) {
    super(message, { cause });
    this.name = "RegistryUnavailableError";
    this.code = "HOOK_REGISTRY_UNAVAILABLE";
  }
}

async function loadFallbackRegistry(path) {
  const source = await readFile(path, "utf8");
  return assertValidRegistry(JSON.parse(source));
}

export function createRegistryService({
  apiBase = process.env.TASKMARKET_API_URL || TASKMARKET_API_BASE,
  fetchImpl = globalThis.fetch,
  cacheTtlMs = 5 * 60_000,
  fallbackPath = defaultFallbackPath,
  now = () => Date.now(),
  loadMetadata = loadCuratedHookMetadata,
  fetchTasks = fetchAllPublicTasks,
} = {}) {
  let cachedRegistry = null;
  let cachedAt = 0;
  let refreshPromise = null;

  async function refresh() {
    const [tasks, curatedMetadata] = await Promise.all([
      fetchTasks({ apiBase, fetchImpl }),
      loadMetadata(),
    ]);
    const registry = assertValidRegistry(buildRegistry(tasks, {
      curatedMetadata,
      source: taskmarketTasksSource(apiBase),
    }));
    cachedRegistry = registry;
    cachedAt = now();
    return registry;
  }

  function startRefresh() {
    if (!refreshPromise) {
      refreshPromise = refresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function getRegistry() {
    const age = now() - cachedAt;
    if (cachedRegistry && age < cacheTtlMs) return cachedRegistry;

    if (cachedRegistry) {
      // Serve stale data immediately while one refresh updates the warm process cache.
      startRefresh().catch(() => {});
      return cachedRegistry;
    }

    try {
      return await startRefresh();
    } catch (upstreamError) {
      try {
        cachedRegistry = await loadFallbackRegistry(fallbackPath);
        cachedAt = now();
        return cachedRegistry;
      } catch (fallbackError) {
        throw new RegistryUnavailableError(undefined, {
          cause: new AggregateError([upstreamError, fallbackError], "Live and fallback registries failed."),
        });
      }
    }
  }

  return {
    getRegistry,
    refresh,
    clear() {
      cachedRegistry = null;
      cachedAt = 0;
      refreshPromise = null;
    },
  };
}

export const hookRegistryService = createRegistryService();

export function getHookRegistry() {
  return hookRegistryService.getRegistry();
}
