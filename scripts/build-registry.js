import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCuratedHookMetadata } from "../lib/curated-hooks.js";
import { buildRegistry, TASKMARKET_API_BASE } from "../lib/hook-registry.js";
import { assertValidRegistry } from "../lib/registry-validation.js";
import { fetchAllPublicTasks, taskmarketTasksSource } from "../lib/taskmarket-client.js";

function parseArgs(argv) {
  const options = {
    apiBase: process.env.TASKMARKET_API_URL || TASKMARKET_API_BASE,
    output: "public/registry.json",
    input: null,
    generatedAt: new Date(),
    source: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!["--api-base", "--output", "--input", "--generated-at", "--source"].includes(argument)) {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
    if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value.`);
    index += 1;

    if (argument === "--api-base") options.apiBase = value;
    if (argument === "--output") options.output = value;
    if (argument === "--input") options.input = value;
    if (argument === "--generated-at") options.generatedAt = new Date(value);
    if (argument === "--source") options.source = value;
  }

  return options;
}

async function readTasks(path) {
  const document = JSON.parse(await readFile(resolve(path), "utf8"));
  if (Array.isArray(document)) return document;
  if (document && Array.isArray(document.tasks)) return document.tasks;
  throw new TypeError("--input must contain a task array or an object with a tasks array.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [tasks, curatedMetadata] = await Promise.all([
    options.input
      ? readTasks(options.input)
      : fetchAllPublicTasks({ apiBase: options.apiBase }),
    loadCuratedHookMetadata(),
  ]);

  const registry = assertValidRegistry(buildRegistry(tasks, {
    curatedMetadata,
    generatedAt: options.generatedAt,
    source: options.source || taskmarketTasksSource(options.apiBase),
  }));
  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${registry.totalHooks} hooks from ${registry.totalTasksScanned} public tasks to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
