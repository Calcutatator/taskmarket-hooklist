import { TASKMARKET_API_BASE } from "./hook-registry.js";

const defaultDetailCache = new Map();

export class TaskmarketApiError extends Error {
  constructor(message, { status = null, cause = undefined } = {}) {
    super(message, { cause });
    this.name = "TaskmarketApiError";
    this.status = status;
  }
}

export function taskmarketApiRoot(apiBase = TASKMARKET_API_BASE) {
  const base = String(apiBase || TASKMARKET_API_BASE).replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

export function taskmarketTasksSource(apiBase = TASKMARKET_API_BASE) {
  return `${taskmarketApiRoot(apiBase)}/tasks?status=ALL`;
}

function requestSignal(signal, timeoutMs) {
  return signal || AbortSignal.timeout(timeoutMs);
}

async function requestJson(fetchImpl, url, { signal, timeoutMs, notFoundAsNull = false } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: requestSignal(signal, timeoutMs),
    });
  } catch (error) {
    throw new TaskmarketApiError("Unable to reach the Taskmarket API.", { cause: error });
  }

  if (notFoundAsNull && response?.status === 404) return null;
  if (!response?.ok) {
    throw new TaskmarketApiError(
      `Taskmarket request failed with HTTP ${response?.status ?? "unknown"}.`,
      { status: response?.status ?? null },
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new TaskmarketApiError("Taskmarket returned invalid JSON.", { cause: error });
  }
}

function hasInlineHookFields(task) {
  return task?.hookContract !== null && task?.hookContract !== undefined
    || task?.hooks !== null && task?.hooks !== undefined;
}

async function fetchTaskHookFields(taskId, {
  apiRoot,
  fetchImpl,
  signal,
  timeoutMs,
  detailCache,
}) {
  const normalizedId = taskId.toLowerCase();
  const cacheKey = `${apiRoot}:${normalizedId}`;
  if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);

  const pending = (async () => {
    const detail = await requestJson(
      fetchImpl,
      new URL(`${apiRoot}/tasks/${encodeURIComponent(taskId)}`),
      { signal, timeoutMs, notFoundAsNull: true },
    );

    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
      return { hookContract: null, hooks: null };
    }

    return {
      hookContract: detail.hookContract ?? null,
      hooks: detail.hooks ?? null,
    };
  })();

  detailCache.set(cacheKey, pending);
  try {
    const fields = await pending;
    detailCache.set(cacheKey, fields);
    return fields;
  } catch (error) {
    detailCache.delete(cacheKey);
    throw error;
  }
}

export async function hydrateTaskHookFields(tasks, {
  apiBase = TASKMARKET_API_BASE,
  fetchImpl = globalThis.fetch,
  concurrency = 8,
  timeoutMs = 20_000,
  signal,
  detailCache = defaultDetailCache,
} = {}) {
  if (!Array.isArray(tasks)) throw new TypeError("tasks must be an array.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new RangeError("concurrency must be an integer from 1 through 32.");
  }

  const apiRoot = taskmarketApiRoot(apiBase);
  const hydrated = [...tasks];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];

      if (!task || typeof task !== "object" || Array.isArray(task) || hasInlineHookFields(task)) {
        continue;
      }

      const taskId = typeof task.id === "string" ? task.id.trim() : "";
      if (!taskId) continue;

      const fields = await fetchTaskHookFields(taskId, {
        apiRoot,
        fetchImpl,
        signal,
        timeoutMs,
        detailCache,
      });
      hydrated[index] = { ...task, ...fields };
    }
  }

  const workerCount = Math.min(concurrency, Math.max(tasks.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return hydrated;
}

export async function fetchAllPublicTasks({
  apiBase = TASKMARKET_API_BASE,
  fetchImpl = globalThis.fetch,
  limit = 100,
  maxPages = 10_000,
  timeoutMs = 20_000,
  signal,
  detailConcurrency = 8,
  detailCache = defaultDetailCache,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("limit must be an integer from 1 through 100.");
  }

  const tasks = [];
  const seenCursors = new Set();
  const apiRoot = taskmarketApiRoot(apiBase);
  let cursor = null;
  let pageNumber = 0;

  while (true) {
    if (pageNumber >= maxPages) {
      throw new TaskmarketApiError(`Task pagination exceeded ${maxPages} pages.`);
    }

    const cursorKey = cursor ?? "__first_page__";
    if (seenCursors.has(cursorKey)) {
      throw new TaskmarketApiError("Taskmarket returned a repeated pagination cursor.");
    }
    seenCursors.add(cursorKey);

    const url = new URL(`${apiRoot}/tasks`);
    url.searchParams.set("status", "ALL");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort", "newest");
    if (cursor) url.searchParams.set("cursor", cursor);

    const page = await requestJson(fetchImpl, url, { signal, timeoutMs });
    if (!page || typeof page !== "object" || !Array.isArray(page.tasks)) {
      throw new TaskmarketApiError("Taskmarket returned an invalid task page.");
    }

    tasks.push(...page.tasks);
    pageNumber += 1;

    if (page.hasMore !== true) break;
    if (typeof page.nextCursor !== "string" || !page.nextCursor.trim()) {
      throw new TaskmarketApiError("Taskmarket indicated more tasks without a next cursor.");
    }

    cursor = page.nextCursor;
  }

  return hydrateTaskHookFields(tasks, {
    apiBase,
    fetchImpl,
    concurrency: detailConcurrency,
    timeoutMs,
    signal,
    detailCache,
  });
}
