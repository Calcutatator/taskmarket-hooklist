import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentsRoot = path.join(appRoot, 'components');
const storiesRoot = path.join(appRoot, 'stories');
const exclusionsPath = path.join(appRoot, '.storybook', 'component-exclusions.json');
const a11yLegacyPath = path.join(appRoot, '.storybook', 'a11y-legacy.json');
const coveragePattern = /storybook-coverage:\s*(components\/[\w./-]+\.tsx)/g;
const blockingA11yPattern = /a11y:\s*{[\s\S]*?test:\s*['"]error['"]/;

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
  return path.relative(appRoot, file).split(path.sep).join('/');
}

const componentFiles = (await filesBelow(componentsRoot))
  .map(relativeModule)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .sort();
const storyFiles = (await filesBelow(storiesRoot)).filter((file) => file.endsWith('.stories.tsx'));
const storyModules = storyFiles.map(relativeModule);
const covered = new Set();
const storySources = new Map();

for (const storyFile of storyFiles) {
  const source = await readFile(storyFile, 'utf8');
  storySources.set(relativeModule(storyFile), source);
  for (const match of source.matchAll(coveragePattern)) {
    covered.add(match[1]);
  }
}

const exclusions = JSON.parse(await readFile(exclusionsPath, 'utf8'));
const a11yLegacy = JSON.parse(await readFile(a11yLegacyPath, 'utf8'));
const excluded = new Set(Object.keys(exclusions));
const legacyStories = new Set(Object.keys(a11yLegacy));
const known = new Set(componentFiles);
const knownStories = new Set(storyModules);

const uncovered = componentFiles.filter((file) => !covered.has(file) && !excluded.has(file));
const staleCoverage = [...covered].filter((file) => !known.has(file));
const staleExclusions = [...excluded].filter((file) => !known.has(file));
const invalidReasons = Object.entries(exclusions)
  .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 24)
  .map(([file]) => file);
const staleLegacyStories = [...legacyStories].filter((file) => !knownStories.has(file));
const invalidLegacyReasons = Object.entries(a11yLegacy)
  .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 24)
  .map(([file]) => file);
const storiesWithoutBlockingA11y = storyModules.filter(
  (file) => !legacyStories.has(file) && !blockingA11yPattern.test(storySources.get(file))
);

if (
  uncovered.length ||
  staleCoverage.length ||
  staleExclusions.length ||
  invalidReasons.length ||
  staleLegacyStories.length ||
  invalidLegacyReasons.length ||
  storiesWithoutBlockingA11y.length
) {
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
  if (staleLegacyStories.length) {
    console.error('Accessibility legacy entries for missing story files:');
    console.error(staleLegacyStories.map((file) => `  - ${file}`).join('\n'));
  }
  if (invalidLegacyReasons.length) {
    console.error('Accessibility legacy entries need a specific reason of at least 24 characters:');
    console.error(invalidLegacyReasons.map((file) => `  - ${file}`).join('\n'));
  }
  if (storiesWithoutBlockingA11y.length) {
    console.error('Non-legacy story files must set parameters.a11y.test to error:');
    console.error(storiesWithoutBlockingA11y.map((file) => `  - ${file}`).join('\n'));
  }
  process.exitCode = 1;
} else {
  console.log(
    `Storybook coverage complete: ${covered.size} covered component modules, ${excluded.size} documented non-standalone exclusions, ${legacyStories.size} explicit accessibility migrations.`
  );
}
