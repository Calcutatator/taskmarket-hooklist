import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentsRoot = path.join(webRoot, 'components');
const storiesRoot = path.join(webRoot, 'stories');
const exclusionsPath = path.join(webRoot, '.storybook', 'component-exclusions.json');
const coveragePattern = /storybook-coverage:\s*(components\/[\w./-]+\.tsx)/g;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(resolved) : [resolved];
    })
  );
  return nested.flat();
}

function relativeModule(file) {
  return path.relative(webRoot, file).split(path.sep).join('/');
}

const componentFiles = (await filesBelow(componentsRoot))
  .map(relativeModule)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .sort();

const storyFiles = (await filesBelow(storiesRoot)).filter((file) => file.endsWith('.stories.tsx'));
const covered = new Set();

for (const storyFile of storyFiles) {
  const source = await readFile(storyFile, 'utf8');
  for (const match of source.matchAll(coveragePattern)) {
    covered.add(match[1]);
  }
}

const exclusions = JSON.parse(await readFile(exclusionsPath, 'utf8'));
const excluded = new Set(Object.keys(exclusions));
const known = new Set(componentFiles);

const uncovered = componentFiles.filter((file) => !covered.has(file) && !excluded.has(file));
const staleCoverage = [...covered].filter((file) => !known.has(file));
const staleExclusions = [...excluded].filter((file) => !known.has(file));
const invalidReasons = Object.entries(exclusions)
  .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 24)
  .map(([file]) => file);

if (uncovered.length || staleCoverage.length || staleExclusions.length || invalidReasons.length) {
  if (uncovered.length) {
    console.error(`Component modules missing Storybook coverage (${uncovered.length}):`);
    console.error(uncovered.map((file) => `  - ${file}`).join('\n'));
  }
  if (staleCoverage.length) {
    console.error('Coverage markers for missing component modules:');
    console.error(staleCoverage.map((file) => `  - ${file}`).join('\n'));
  }
  if (staleExclusions.length) {
    console.error('Exclusions for missing component modules:');
    console.error(staleExclusions.map((file) => `  - ${file}`).join('\n'));
  }
  if (invalidReasons.length) {
    console.error('Exclusions need a specific reason of at least 24 characters:');
    console.error(invalidReasons.map((file) => `  - ${file}`).join('\n'));
  }
  process.exitCode = 1;
} else {
  console.log(
    `Storybook coverage complete: ${covered.size} covered component modules, ${excluded.size} documented non-standalone exclusions.`
  );
}
