// @vitest-environment node

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(process.cwd(), '../..');
const publicSkillDir = path.join(repositoryRoot, 'apps/docs/src/public');
const installerPath = path.join(repositoryRoot, 'apps/web/public/install-skill.sh');
const manifestPath = path.join(publicSkillDir, 'reference/skill-manifest.txt');
const temporaryDirectories: string[] = [];

function packageFiles(): string[] {
  return [
    'skill.md',
    ...['examples', 'modes', 'reference'].flatMap((directory) =>
      filesBelow(path.join(publicSkillDir, directory), directory)
    ),
  ].filter((file) => file !== 'reference/skill-manifest.txt');
}

function manifestFiles(): string[] {
  return readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function localPackageLinks(sourceFile: string): string[] {
  if (!sourceFile.endsWith('.md')) return [];
  const markdown = readFileSync(path.join(publicSkillDir, sourceFile), 'utf8');
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter(
      (target) =>
        !target.startsWith('#') &&
        !target.startsWith('data:') &&
        !target.startsWith('mailto:') &&
        !target.includes('://')
    )
    .map((target) => {
      const pathOnly = target.split('#')[0].split('?')[0];
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(sourceFile), pathOnly)
      );
      return resolved === 'SKILL.md' ? 'skill.md' : resolved;
    });
}

function filesBelow(directory: string, prefix = ''): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const absolutePath = path.join(directory, name);
      const relativePath = path.posix.join(prefix, name);
      return statSync(absolutePath).isDirectory()
        ? filesBelow(absolutePath, relativePath)
        : [relativePath];
    });
}

function runInstaller(baseUrl: string, targetDirectory: string) {
  return new Promise<{ stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn('sh', [installerPath, baseUrl], {
      env: { ...process.env, TASKMARKET_SKILL_DIR: targetDirectory },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr, stdout });
      else reject(new Error(`installer exited ${code}: ${stderr}`));
    });
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Taskmarket skill package', () => {
  it('keeps the manifest equal to the complete canonical package', () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(manifestFiles()).toEqual(packageFiles());
  });

  it('resolves every local link and keeps every package file reachable', () => {
    const expectedFiles = new Set(packageFiles());
    const reachable = new Set<string>();
    const queue = ['skill.md'];

    while (queue.length > 0) {
      const sourceFile = queue.shift();
      if (!sourceFile || reachable.has(sourceFile)) continue;
      expect(expectedFiles.has(sourceFile), `missing ${sourceFile}`).toBe(true);
      reachable.add(sourceFile);
      for (const target of localPackageLinks(sourceFile)) {
        expect(target.startsWith('../'), `link escapes package: ${sourceFile} -> ${target}`).toBe(
          false
        );
        queue.push(target);
      }
    }

    expect([...reachable].sort()).toEqual([...expectedFiles].sort());
  });

  it('publishes every canonical entry point without copied-file drift', () => {
    const publishers = [
      path.join(repositoryRoot, 'apps/backend'),
      path.join(repositoryRoot, 'apps/web/public'),
    ];
    for (const publisher of publishers) {
      for (const entry of [
        'skill.md',
        'examples',
        'modes',
        'reference',
        'reference/skill-manifest.txt',
      ]) {
        expect(realpathSync(path.join(publisher, entry))).toBe(
          realpathSync(path.join(publicSkillDir, entry))
        );
      }
    }
  });

  it('installs the exact manifest over HTTP', async () => {
    const requestedPaths: string[] = [];
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1);
      requestedPaths.push(pathname);
      const filePath = path.resolve(publicSkillDir, pathname);
      if (!filePath.startsWith(`${publicSkillDir}${path.sep}`) || !existsSync(filePath)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(readFileSync(filePath));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local server did not bind');
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'taskmarket-skill-test-'));
    temporaryDirectories.push(temporaryRoot);
    const targetDirectory = path.join(temporaryRoot, 'taskmarket');
    mkdirSync(path.join(targetDirectory, 'reference'), { recursive: true });
    writeFileSync(path.join(targetDirectory, 'reference/removed.md'), 'stale package file\n');

    try {
      const result = await runInstaller(`http://127.0.0.1:${address.port}`, targetDirectory);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(`Installed Taskmarket skill at ${targetDirectory}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }

    expect(requestedPaths).toEqual(['reference/skill-manifest.txt', ...manifestFiles()]);
    expect(filesBelow(targetDirectory)).toEqual(
      manifestFiles()
        .map((file) => (file === 'skill.md' ? 'SKILL.md' : file))
        .sort()
    );
    for (const file of manifestFiles()) {
      const installedPath = file === 'skill.md' ? 'SKILL.md' : file;
      expect(readFileSync(path.join(targetDirectory, installedPath), 'utf8')).toBe(
        readFileSync(path.join(publicSkillDir, file), 'utf8')
      );
    }
  });
});
