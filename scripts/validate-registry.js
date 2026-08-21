import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCuratedHookMetadata } from "../lib/curated-hooks.js";
import { assertValidRegistry } from "../lib/registry-validation.js";

async function main() {
  const registryPath = resolve(process.argv[2] || "public/registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assertValidRegistry(registry);
  const curatedMetadata = await loadCuratedHookMetadata();
  console.log(
    `Valid registry: ${registry.totalHooks} hooks, ${registry.totalTasksScanned} tasks, ${curatedMetadata.length} curated metadata records`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
