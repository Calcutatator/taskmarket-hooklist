import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(repositoryRoot, 'apps/docs/src/public');
const manifestPath = path.join(sourceDirectory, 'reference/skill-manifest.txt');
const targetArgument = process.argv[2];

if (!targetArgument) {
  throw new Error('Usage: node scripts/export-skills-market.mjs <empty-output-directory>');
}

const targetDirectory = path.resolve(targetArgument);
if (existsSync(targetDirectory)) {
  throw new Error(`Output directory already exists: ${targetDirectory}`);
}

const manifestFiles = readFileSync(manifestPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

for (const relativeFile of manifestFiles) {
  if (path.isAbsolute(relativeFile) || relativeFile.split('/').includes('..')) {
    throw new Error(`Manifest path escapes the skill package: ${relativeFile}`);
  }

  const sourceFile = path.join(sourceDirectory, relativeFile);
  const exportedFile = relativeFile === 'skill.md' ? 'SKILL.md' : relativeFile;
  const targetFile = path.join(targetDirectory, exportedFile);
  mkdirSync(path.dirname(targetFile), { recursive: true });

  if (relativeFile === 'skill.md') {
    const canonicalRoot = readFileSync(sourceFile, 'utf8');
    const skillsMarketRoot = canonicalRoot.replace(/^name: taskmarket-operator$/m, 'name: taskmarket');
    if (canonicalRoot === skillsMarketRoot) {
      throw new Error('Canonical skill frontmatter no longer declares taskmarket-operator');
    }
    writeFileSync(targetFile, skillsMarketRoot);
  } else {
    copyFileSync(sourceFile, targetFile);
  }
}

console.log(`Exported Taskmarket skill to ${targetDirectory}`);
