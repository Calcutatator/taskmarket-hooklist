import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKMARKET_CHAIN_ID, normalizeHookAddress } from "./hook-registry.js";
import { assertValidCuratedHook } from "./registry-validation.js";

const defaultHooksDirectory = fileURLToPath(new URL("../data/hooks/", import.meta.url));

async function readJson(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`Unable to parse ${path}: ${error.message}`);
  }
}

function addMetadata(index, metadata, label) {
  assertValidCuratedHook(metadata, label);
  if (index.has(metadata.address)) {
    throw new TypeError(`Duplicate curated hook metadata for ${metadata.address}.`);
  }
  index.set(metadata.address, metadata);
}

export async function loadCuratedHookMetadata({ directory = defaultHooksDirectory } = {}) {
  const indexPath = join(directory, "index.json");
  const manifest = await readJson(indexPath);
  const metadataByAddress = new Map();
  const referencedAddresses = new Set();

  if (manifest !== null) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new TypeError("data/hooks/index.json must contain an object.");
    }
    if (manifest.chainId !== TASKMARKET_CHAIN_ID) {
      throw new TypeError("data/hooks/index.json chainId must be 8453.");
    }
    if (Object.keys(manifest).some((key) => !["$schema", "chainId", "hooks"].includes(key))) {
      throw new TypeError("data/hooks/index.json contains unsupported fields.");
    }
    if ("$schema" in manifest && (typeof manifest.$schema !== "string" || !manifest.$schema.trim())) {
      throw new TypeError("data/hooks/index.json $schema must be a non-empty string.");
    }
    if (!Array.isArray(manifest.hooks)) {
      throw new TypeError("data/hooks/index.json hooks must be an array.");
    }

    const seenManifestAddresses = new Set();
    for (const entry of manifest.hooks) {
      if (typeof entry === "string") {
        const address = normalizeHookAddress(entry);
        if (!address || address !== entry) {
          throw new TypeError(`Invalid hook address in data/hooks/index.json: ${entry}`);
        }
        if (seenManifestAddresses.has(address)) {
          throw new TypeError(`Duplicate hook address in data/hooks/index.json: ${address}`);
        }
        seenManifestAddresses.add(address);
        referencedAddresses.add(address);
      } else {
        addMetadata(metadataByAddress, entry, "data/hooks/index.json");
        if (seenManifestAddresses.has(entry?.address)) {
          throw new TypeError(`Duplicate hook address in data/hooks/index.json: ${entry?.address}`);
        }
        seenManifestAddresses.add(entry.address);
        referencedAddresses.delete(entry.address);
      }
    }
  }

  let files = [];
  try {
    files = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  for (const file of files) {
    if (!file.isFile() || file.name === "index.json" || !file.name.endsWith(".json")) continue;

    const addressFromName = file.name.slice(0, -5);
    const normalizedAddress = normalizeHookAddress(addressFromName);
    if (!normalizedAddress || normalizedAddress !== addressFromName) {
      throw new TypeError(`Curated hook filename must be a lowercase address: ${file.name}`);
    }

    const metadata = await readJson(join(directory, file.name));
    if (metadata?.address !== addressFromName) {
      throw new TypeError(`${file.name} address must match its filename.`);
    }
    addMetadata(metadataByAddress, metadata, file.name);
    referencedAddresses.delete(addressFromName);
  }

  if (referencedAddresses.size) {
    throw new TypeError(
      `Missing curated hook files: ${[...referencedAddresses].map((address) => `${address}.json`).join(", ")}`,
    );
  }

  return [...metadataByAddress.values()].sort((left, right) => left.address.localeCompare(right.address));
}
