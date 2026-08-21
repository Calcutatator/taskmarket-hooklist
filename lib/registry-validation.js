import { TASKMARKET_CHAIN_ID, normalizeHookAddress } from "./hook-registry.js";

const TASK_ID_PATTERN = /^0x[0-9a-f]{64}$/;
const URL_FIELDS = ["repository", "homepage", "auditUrl", "sourceUrl"];
const NULLABLE_TEXT_FIELDS = ["name", "description", "author", "license"];
const DEFAULT_STATUSES = new Set([
  "current_confirmed",
  "historical_confirmed",
  "historical_inferred",
  "custom",
  "unknown",
]);
const PROXY_KINDS = new Set(["none", "none_or_unknown", "erc1967", "unknown"]);
const HOOK_FIELDS = [
  "address",
  "chainId",
  "name",
  "description",
  "author",
  "repository",
  "homepage",
  "license",
  "categories",
  "verified",
  "auditUrl",
  "sourceUrl",
  "currentDefault",
  "defaultStatus",
  "proxyKind",
  "implementationAddress",
  "proxySourceVerified",
  "taskCount",
  "usageCount",
  "activeTaskCount",
  "modes",
  "statuses",
  "tags",
  "requesterCount",
  "firstSeen",
  "lastSeen",
  "exampleTasks",
];
const REGISTRY_FIELDS = [
  "generatedAt",
  "source",
  "chainId",
  "totalTasksScanned",
  "totalHooks",
  "hooks",
];
const CURATED_FIELDS = [
  "$schema",
  "address",
  "chainId",
  "name",
  "description",
  "author",
  "repository",
  "homepage",
  "license",
  "categories",
  "verified",
  "auditUrl",
  "sourceUrl",
  "currentDefault",
  "defaultStatus",
  "proxyKind",
  "implementationAddress",
  "proxySourceVerified",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoTimestamp(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function hasOnlyFields(value, fields) {
  return Object.keys(value).every((key) => fields.includes(key));
}

function pushArrayErrors(errors, value, path, { lowercase = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }

  if (value.some((item) => !isNonEmptyString(item))) {
    errors.push(`${path} must contain only non-empty strings.`);
    return;
  }

  if (new Set(value).size !== value.length) errors.push(`${path} must not contain duplicates.`);
  const sorted = [...value].sort((left, right) => left.localeCompare(right));
  if (value.some((item, index) => item !== sorted[index])) errors.push(`${path} must be sorted.`);
  if (lowercase && value.some((item) => item !== item.toLowerCase())) {
    errors.push(`${path} must use lowercase values.`);
  }
}

function validateHookEntry(hook, index, totalTasksScanned, errors) {
  const path = `hooks[${index}]`;
  if (!isObject(hook)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!hasOnlyFields(hook, HOOK_FIELDS)) errors.push(`${path} has unsupported fields.`);
  for (const field of HOOK_FIELDS) {
    if (!(field in hook)) errors.push(`${path}.${field} is required.`);
  }

  const normalizedAddress = normalizeHookAddress(hook.address);
  if (!normalizedAddress || normalizedAddress !== hook.address) {
    errors.push(`${path}.address must be a lowercase EVM address.`);
  }
  if (hook.chainId !== TASKMARKET_CHAIN_ID) errors.push(`${path}.chainId must be 8453.`);

  for (const field of NULLABLE_TEXT_FIELDS) {
    if (hook[field] !== null && !isNonEmptyString(hook[field])) {
      errors.push(`${path}.${field} must be null or a non-empty string.`);
    }
  }
  for (const field of URL_FIELDS) {
    if (hook[field] !== null && !isHttpUrl(hook[field])) {
      errors.push(`${path}.${field} must be null or an HTTP(S) URL.`);
    }
  }
  if (typeof hook.currentDefault !== "boolean") errors.push(`${path}.currentDefault must be a boolean.`);
  if (!DEFAULT_STATUSES.has(hook.defaultStatus)) {
    errors.push(`${path}.defaultStatus is not supported.`);
  }
  if (!PROXY_KINDS.has(hook.proxyKind)) errors.push(`${path}.proxyKind is not supported.`);
  if (hook.implementationAddress !== null) {
    const normalizedImplementation = normalizeHookAddress(hook.implementationAddress);
    if (!normalizedImplementation || normalizedImplementation !== hook.implementationAddress) {
      errors.push(`${path}.implementationAddress must be null or a lowercase EVM address.`);
    }
  }
  if (typeof hook.proxySourceVerified !== "boolean") {
    errors.push(`${path}.proxySourceVerified must be a boolean.`);
  }

  pushArrayErrors(errors, hook.categories, `${path}.categories`, { lowercase: true });
  pushArrayErrors(errors, hook.modes, `${path}.modes`, { lowercase: true });
  pushArrayErrors(errors, hook.statuses, `${path}.statuses`, { lowercase: true });
  pushArrayErrors(errors, hook.tags, `${path}.tags`, { lowercase: true });

  if (typeof hook.verified !== "boolean") errors.push(`${path}.verified must be a boolean.`);
  for (const field of ["taskCount", "usageCount", "activeTaskCount", "requesterCount"]) {
    if (!Number.isInteger(hook[field]) || hook[field] < 0) {
      errors.push(`${path}.${field} must be a non-negative integer.`);
    }
  }
  if (Number.isInteger(hook.activeTaskCount) && Number.isInteger(hook.taskCount)
    && hook.activeTaskCount > hook.taskCount) {
    errors.push(`${path}.activeTaskCount cannot exceed taskCount.`);
  }
  if (Number.isInteger(hook.requesterCount) && Number.isInteger(hook.taskCount)
    && hook.requesterCount > hook.taskCount) {
    errors.push(`${path}.requesterCount cannot exceed taskCount.`);
  }
  if (Number.isInteger(hook.taskCount) && Number.isInteger(totalTasksScanned)
    && hook.taskCount > totalTasksScanned) {
    errors.push(`${path}.taskCount cannot exceed totalTasksScanned.`);
  }
  if (Number.isInteger(hook.usageCount) && Number.isInteger(hook.taskCount)
    && hook.usageCount < hook.taskCount) {
    errors.push(`${path}.usageCount cannot be less than taskCount.`);
  }

  for (const field of ["firstSeen", "lastSeen"]) {
    if (hook[field] !== null && !isIsoTimestamp(hook[field])) {
      errors.push(`${path}.${field} must be null or a normalized ISO timestamp.`);
    }
  }
  if (isIsoTimestamp(hook.firstSeen) && isIsoTimestamp(hook.lastSeen)
    && hook.firstSeen > hook.lastSeen) {
    errors.push(`${path}.firstSeen cannot be later than lastSeen.`);
  }

  if (!Array.isArray(hook.exampleTasks)) {
    errors.push(`${path}.exampleTasks must be an array.`);
  } else {
    if (hook.exampleTasks.length > 3) errors.push(`${path}.exampleTasks cannot contain more than 3 tasks.`);
    hook.exampleTasks.forEach((task, taskIndex) => {
      const taskPath = `${path}.exampleTasks[${taskIndex}]`;
      if (!isObject(task)) {
        errors.push(`${taskPath} must be an object.`);
        return;
      }
      if (!hasOnlyFields(task, ["id", "title", "status", "mode"])) {
        errors.push(`${taskPath} has unsupported fields.`);
      }
      if (!isNonEmptyString(task.id) || !TASK_ID_PATTERN.test(task.id)) {
        errors.push(`${taskPath}.id must be a lowercase 32-byte task ID.`);
      }
      for (const field of ["title", "status", "mode"]) {
        if (!isNonEmptyString(task[field])) errors.push(`${taskPath}.${field} must be a non-empty string.`);
      }
    });
  }
}

export function validateRegistry(registry) {
  const errors = [];
  if (!isObject(registry)) return { valid: false, errors: ["Registry must be an object."] };
  if (!hasOnlyFields(registry, REGISTRY_FIELDS)) errors.push("Registry has unsupported fields.");
  for (const field of REGISTRY_FIELDS) {
    if (!(field in registry)) errors.push(`Registry.${field} is required.`);
  }

  if (!isIsoTimestamp(registry.generatedAt)) errors.push("Registry.generatedAt must be a normalized ISO timestamp.");
  if (!isHttpUrl(registry.source)) errors.push("Registry.source must be an HTTP(S) URL.");
  if (registry.chainId !== TASKMARKET_CHAIN_ID) errors.push("Registry.chainId must be 8453.");
  if (!Number.isInteger(registry.totalTasksScanned) || registry.totalTasksScanned < 0) {
    errors.push("Registry.totalTasksScanned must be a non-negative integer.");
  }
  if (!Number.isInteger(registry.totalHooks) || registry.totalHooks < 0) {
    errors.push("Registry.totalHooks must be a non-negative integer.");
  }
  if (!Array.isArray(registry.hooks)) {
    errors.push("Registry.hooks must be an array.");
  } else {
    if (registry.totalHooks !== registry.hooks.length) {
      errors.push("Registry.totalHooks must equal Registry.hooks.length.");
    }
    registry.hooks.forEach((hook, index) => validateHookEntry(
      hook,
      index,
      registry.totalTasksScanned,
      errors,
    ));
    const addresses = registry.hooks.map((hook) => hook?.address).filter(Boolean);
    if (new Set(addresses).size !== addresses.length) errors.push("Registry.hooks addresses must be unique.");
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidRegistry(registry) {
  const result = validateRegistry(registry);
  if (!result.valid) {
    throw new TypeError(`Invalid hook registry:\n- ${result.errors.join("\n- ")}`);
  }
  return registry;
}

export function validateCuratedHook(metadata) {
  const errors = [];
  if (!isObject(metadata)) return { valid: false, errors: ["Hook metadata must be an object."] };
  if (!hasOnlyFields(metadata, CURATED_FIELDS)) errors.push("Hook metadata has unsupported fields.");
  if ("$schema" in metadata && !isNonEmptyString(metadata.$schema)) {
    errors.push("Hook metadata $schema must be a non-empty string.");
  }

  const normalizedAddress = normalizeHookAddress(metadata.address);
  if (!normalizedAddress || normalizedAddress !== metadata.address) {
    errors.push("Hook metadata address must be a lowercase EVM address.");
  }
  if (metadata.chainId !== TASKMARKET_CHAIN_ID) errors.push("Hook metadata chainId must be 8453.");

  for (const field of NULLABLE_TEXT_FIELDS) {
    if (field in metadata && metadata[field] !== null && !isNonEmptyString(metadata[field])) {
      errors.push(`Hook metadata ${field} must be null or a non-empty string.`);
    }
  }
  for (const field of URL_FIELDS) {
    if (field in metadata && metadata[field] !== null && !isHttpUrl(metadata[field])) {
      errors.push(`Hook metadata ${field} must be null or an HTTP(S) URL.`);
    }
  }
  if ("currentDefault" in metadata && typeof metadata.currentDefault !== "boolean") {
    errors.push("Hook metadata currentDefault must be a boolean.");
  }
  if ("defaultStatus" in metadata && !DEFAULT_STATUSES.has(metadata.defaultStatus)) {
    errors.push("Hook metadata defaultStatus is not supported.");
  }
  if ("proxyKind" in metadata && !PROXY_KINDS.has(metadata.proxyKind)) {
    errors.push("Hook metadata proxyKind is not supported.");
  }
  if ("implementationAddress" in metadata && metadata.implementationAddress !== null) {
    const normalizedImplementation = normalizeHookAddress(metadata.implementationAddress);
    if (!normalizedImplementation || normalizedImplementation !== metadata.implementationAddress) {
      errors.push("Hook metadata implementationAddress must be null or a lowercase EVM address.");
    }
  }
  if ("proxySourceVerified" in metadata && typeof metadata.proxySourceVerified !== "boolean") {
    errors.push("Hook metadata proxySourceVerified must be a boolean.");
  }
  if ("categories" in metadata) {
    pushArrayErrors(errors, metadata.categories, "Hook metadata categories", { lowercase: true });
  }
  if ("verified" in metadata && typeof metadata.verified !== "boolean") {
    errors.push("Hook metadata verified must be a boolean.");
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidCuratedHook(metadata, label = metadata?.address || "unknown hook") {
  const result = validateCuratedHook(metadata);
  if (!result.valid) {
    throw new TypeError(`Invalid curated metadata for ${label}:\n- ${result.errors.join("\n- ")}`);
  }
  return metadata;
}
