import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { statedEmbodimentLastChanged } from './git-history.js';

// Verifies: ADR-0094
//
// Built against a purpose-made repository rather than this one: the property under test is that a
// commit changing only the field's value is found, and the shipped corpus cannot be relied on to
// contain that shape at a known date.

let repo: string;
let adrDir: string;

function record(embodiment: string, trailer = ''): string {
  return `# 0042 — A record\n\n- **Status:** Accepted\n- **Embodiment:** ${embodiment}\n\n## Context\n\n${trailer}\n`;
}

function commit(body: string, date: string): void {
  writeFileSync(join(adrDir, '0042-a-record.md'), body);
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'edit', '--no-verify'], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` },
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'adr-git-history-'));
  adrDir = join(repo, 'docs', 'adr');
  mkdirSync(adrDir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
  for (const [k, v] of [
    ['user.email', 't@example.com'],
    ['user.name', 'Test'],
    ['commit.gpgsign', 'false'],
  ]) {
    execFileSync('git', ['config', k, v], { cwd: repo, stdio: 'ignore' });
  }
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('statedEmbodimentLastChanged', () => {
  it('returns the later of two commits that change only the field value', () => {
    commit(record('Not started'), '2026-01-05');
    commit(record('Implemented'), '2026-02-10');
    commit(record('Verified'), '2026-03-15');
    expect(statedEmbodimentLastChanged(repo, adrDir, '0042')).toBe('2026-03-15');
  });

  it('ignores an edit that rewrites prose but leaves the claim standing', () => {
    commit(record('Implemented'), '2026-01-05');
    commit(record('Implemented', 'Rewritten context, same claim.'), '2026-04-01');
    expect(statedEmbodimentLastChanged(repo, adrDir, '0042')).toBe('2026-01-05');
  });

  it('returns null when no record matches the number', () => {
    commit(record('Implemented'), '2026-01-05');
    expect(statedEmbodimentLastChanged(repo, adrDir, '0099')).toBeNull();
  });

  it('returns null rather than throwing outside a repository', () => {
    const bare = mkdtempSync(join(tmpdir(), 'adr-no-git-'));
    const dir = join(bare, 'docs', 'adr');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '0042-a-record.md'), record('Implemented'));
    try {
      expect(statedEmbodimentLastChanged(bare, dir, '0042')).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
