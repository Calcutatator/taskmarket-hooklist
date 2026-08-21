import { cp, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicDirectory = resolve(projectRoot, "public");
const outputDirectory = resolve(projectRoot, "dist");
const expectedRelativeOutput = relative(projectRoot, outputDirectory);

if (expectedRelativeOutput !== "dist") {
  throw new Error("GitHub Pages output must resolve to the repository's dist directory.");
}

try {
  const existingOutput = await lstat(outputDirectory);
  if (existingOutput.isSymbolicLink()) {
    throw new Error("Refusing to replace a symbolic-link dist directory.");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of ["index.html", "styles.css", "app.js", "config.js", "registry.json", "assets"]) {
  await cp(join(publicDirectory, entry), join(outputDirectory, entry), { recursive: true });
}

await writeFile(
  join(outputDirectory, "config.js"),
  'globalThis.TASKMARKET_HOOKLIST_CONFIG = Object.freeze({ registryMode: "static" });\n',
  "utf8",
);

console.log(`Built GitHub Pages artifact at ${outputDirectory}`);
