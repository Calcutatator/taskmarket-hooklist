import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertValidRegistry } from "../lib/registry-validation.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = resolve(projectRoot, "dist");
const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "registry.json",
  "assets/base-network.svg",
  "assets/taskmarket-icon.svg",
];

await Promise.all(requiredFiles.map((path) => access(resolve(outputDirectory, path))));

const [html, app, config, registrySource] = await Promise.all([
  readFile(resolve(outputDirectory, "index.html"), "utf8"),
  readFile(resolve(outputDirectory, "app.js"), "utf8"),
  readFile(resolve(outputDirectory, "config.js"), "utf8"),
  readFile(resolve(outputDirectory, "registry.json"), "utf8"),
]);

if (/\b(?:href|src)="\/(?!\/)/.test(html)) {
  throw new Error("GitHub Pages HTML contains a root-relative asset URL.");
}

if (!config.includes('registryMode: "static"')) {
  throw new Error("GitHub Pages config does not select the static registry mode.");
}

if (!app.includes('new URL("./registry.json", document.baseURI)')) {
  throw new Error("Registry snapshot URL is not relative to the deployed page.");
}

const registry = assertValidRegistry(JSON.parse(registrySource));
console.log(
  `Valid GitHub Pages artifact: ${registry.totalHooks} hooks, ${registry.totalTasksScanned} tasks`,
);
