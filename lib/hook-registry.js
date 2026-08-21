export const TASKMARKET_CHAIN_ID = 8453;
export const TASKMARKET_API_BASE = "https://api.taskmarket.dev";

export const ACTIVE_TASK_STATUSES = new Set([
  "open",
  "claimed",
  "worker_selected",
  "pending_approval",
  "review",
  "appealing",
  "disputed",
]);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TASK_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_STATUSES = new Set([
  "current_confirmed",
  "historical_confirmed",
  "historical_inferred",
  "custom",
  "unknown",
]);
const PROXY_KINDS = new Set(["none", "none_or_unknown", "erc1967", "unknown"]);

function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function nullableMetadataString(value) {
  return nonEmptyString(value);
}

function normalizeStringList(value, { lowercase = false } = {}) {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map(nonEmptyString)
    .filter(Boolean)
    .map((item) => (lowercase ? item.toLowerCase() : item));

  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function compareNullableDatesDescending(left, right) {
  if (left && right) return Date.parse(right) - Date.parse(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function taskTitle(task) {
  const line = String(task.description || "")
    .split(/\r?\n/)
    .map((candidate) => candidate.replace(/^\s*#{1,6}\s*/, "").trim())
    .find(Boolean);

  if (!line) return nonEmptyString(task.id) || "Untitled task";
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
}

function normalizeExampleTask(task) {
  const id = nonEmptyString(task.id);
  if (!id || !TASK_ID_PATTERN.test(id)) return null;

  return {
    id: id.toLowerCase(),
    title: taskTitle(task),
    status: nonEmptyString(task.status)?.toLowerCase() || "unknown",
    mode: nonEmptyString(task.mode)?.toLowerCase() || "unknown",
    _createdAt: normalizeTimestamp(task.createdAt),
  };
}

function dedupePublicTasks(tasks) {
  if (!Array.isArray(tasks)) return [];

  const seenIds = new Set();
  const publicTasks = [];

  for (const task of tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;

    const visibility = nonEmptyString(task.taskVisibility)?.toLowerCase();
    if (visibility && visibility !== "public") continue;

    const id = nonEmptyString(task.id)?.toLowerCase();
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }

    publicTasks.push(task);
  }

  return publicTasks;
}

function indexCuratedMetadata(curatedMetadata) {
  const index = new Map();
  const rows = curatedMetadata instanceof Map
    ? [...curatedMetadata.values()]
    : Array.isArray(curatedMetadata)
      ? curatedMetadata
      : [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const address = normalizeHookAddress(row.address);
    if (address) index.set(address, row);
  }

  return index;
}

export function normalizeHookAddress(value) {
  const address = nonEmptyString(value);
  return address && ADDRESS_PATTERN.test(address) ? address.toLowerCase() : null;
}

export function extractTaskHookAddresses(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return [];

  const candidates = [task.hookContract];
  if (Array.isArray(task.hooks)) candidates.push(...task.hooks);

  return [...new Set(candidates.map(normalizeHookAddress).filter(Boolean))];
}

export function aggregateHooks(tasks, { chainId = TASKMARKET_CHAIN_ID, curatedMetadata = [] } = {}) {
  const publicTasks = dedupePublicTasks(tasks);
  const metadataByAddress = indexCuratedMetadata(curatedMetadata);
  const aggregates = new Map();

  for (const task of publicTasks) {
    const addresses = extractTaskHookAddresses(task);
    if (!addresses.length) continue;

    const createdAt = normalizeTimestamp(task.createdAt);
    const status = nonEmptyString(task.status)?.toLowerCase() || "unknown";
    const mode = nonEmptyString(task.mode)?.toLowerCase() || "unknown";
    const requester = nonEmptyString(task.requester)?.toLowerCase();
    const tags = normalizeStringList(task.tags, { lowercase: true });
    const example = normalizeExampleTask(task);

    for (const address of addresses) {
      const aggregate = aggregates.get(address) || {
        address,
        taskCount: 0,
        usageCount: 0,
        activeTaskCount: 0,
        modes: new Set(),
        statuses: new Set(),
        tags: new Set(),
        requesters: new Set(),
        firstSeen: null,
        lastSeen: null,
        examples: [],
      };

      aggregate.taskCount += 1;
      // A hook is counted at most once per task, even if both API fields repeat it.
      aggregate.usageCount += 1;
      if (ACTIVE_TASK_STATUSES.has(status)) aggregate.activeTaskCount += 1;
      aggregate.modes.add(mode);
      aggregate.statuses.add(status);
      tags.forEach((tag) => aggregate.tags.add(tag));
      if (requester) aggregate.requesters.add(requester);

      if (createdAt) {
        if (!aggregate.firstSeen || createdAt < aggregate.firstSeen) aggregate.firstSeen = createdAt;
        if (!aggregate.lastSeen || createdAt > aggregate.lastSeen) aggregate.lastSeen = createdAt;
      }

      if (example) aggregate.examples.push(example);
      aggregates.set(address, aggregate);
    }
  }

  const hooks = [...aggregates.values()].map((aggregate) => {
    const metadata = metadataByAddress.get(aggregate.address) || {};
    const exampleTasks = aggregate.examples
      .sort((left, right) => (
        compareNullableDatesDescending(left._createdAt, right._createdAt)
        || left.id.localeCompare(right.id)
      ))
      .slice(0, 3)
      .map(({ _createdAt, ...example }) => example);

    return {
      address: aggregate.address,
      chainId,
      name: nullableMetadataString(metadata.name),
      description: nullableMetadataString(metadata.description),
      author: nullableMetadataString(metadata.author),
      repository: nullableMetadataString(metadata.repository),
      homepage: nullableMetadataString(metadata.homepage),
      license: nullableMetadataString(metadata.license),
      categories: normalizeStringList(metadata.categories, { lowercase: true }),
      verified: metadata.verified === true,
      auditUrl: nullableMetadataString(metadata.auditUrl),
      sourceUrl: nullableMetadataString(metadata.sourceUrl),
      currentDefault: metadata.currentDefault === true,
      defaultStatus: DEFAULT_STATUSES.has(metadata.defaultStatus) ? metadata.defaultStatus : "unknown",
      proxyKind: PROXY_KINDS.has(metadata.proxyKind) ? metadata.proxyKind : "unknown",
      implementationAddress: normalizeHookAddress(metadata.implementationAddress),
      proxySourceVerified: metadata.proxySourceVerified === true,
      taskCount: aggregate.taskCount,
      usageCount: aggregate.usageCount,
      activeTaskCount: aggregate.activeTaskCount,
      modes: [...aggregate.modes].sort((a, b) => a.localeCompare(b)),
      statuses: [...aggregate.statuses].sort((a, b) => a.localeCompare(b)),
      tags: [...aggregate.tags].sort((a, b) => a.localeCompare(b)),
      requesterCount: aggregate.requesters.size,
      firstSeen: aggregate.firstSeen,
      lastSeen: aggregate.lastSeen,
      exampleTasks,
    };
  });

  hooks.sort((left, right) => (
    right.taskCount - left.taskCount
    || compareNullableDatesDescending(left.lastSeen, right.lastSeen)
    || left.address.localeCompare(right.address)
  ));

  return {
    totalTasksScanned: publicTasks.length,
    totalHooks: hooks.length,
    hooks,
  };
}

export function buildRegistry(tasks, {
  chainId = TASKMARKET_CHAIN_ID,
  curatedMetadata = [],
  generatedAt = new Date(),
  source = `${TASKMARKET_API_BASE}/api/tasks?status=ALL`,
} = {}) {
  const generatedTimestamp = normalizeTimestamp(generatedAt);
  if (!generatedTimestamp) throw new TypeError("generatedAt must be a valid date.");

  const aggregation = aggregateHooks(tasks, { chainId, curatedMetadata });
  return {
    generatedAt: generatedTimestamp,
    source,
    chainId,
    ...aggregation,
  };
}
