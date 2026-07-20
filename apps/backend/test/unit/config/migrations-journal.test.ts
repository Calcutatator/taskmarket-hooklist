import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const migrationsDir = join(__dirname, '../../../drizzle/migrations');
const journalPath = join(migrationsDir, 'meta/_journal.json');

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

function loadJournal(): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(journalPath, 'utf8'));
}

function loadMigrationSql(tag: string): string {
  return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
}

// A single guarded ALTER TABLE ... ADD CONSTRAINT is wrapped in its own
// DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$; block
// (see 0009_add_auction_subtypes.sql for the original pattern this mirrors).
function countUnguardedConstraints(sql: string): number {
  const addConstraints = (sql.match(/ADD CONSTRAINT/g) ?? []).length;
  const doBlocks = (sql.match(/DO \$\$ BEGIN/g) ?? []).length;
  return Math.max(addConstraints - doBlocks, 0);
}

const UNGUARDED_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'CREATE TABLE without IF NOT EXISTS', pattern: /^\s*CREATE TABLE(?!\s+IF NOT EXISTS)\s+"/im },
  {
    name: 'CREATE [UNIQUE] INDEX without IF NOT EXISTS',
    pattern: /^\s*CREATE (UNIQUE )?INDEX(?!\s+IF NOT EXISTS)\s+"/im,
  },
  { name: 'ADD COLUMN without IF NOT EXISTS', pattern: /ADD COLUMN(?!\s+IF NOT EXISTS)\s+"/i },
  { name: 'DROP TABLE without IF EXISTS', pattern: /^\s*DROP TABLE(?!\s+IF EXISTS)\s+"/im },
  { name: 'DROP INDEX without IF EXISTS', pattern: /^\s*DROP INDEX(?!\s+IF EXISTS)\s+"/im },
  { name: 'DROP COLUMN without IF EXISTS', pattern: /DROP COLUMN(?!\s+IF EXISTS)\s+"/i },
];

describe('migrations journal', () => {
  it('has exactly one entry per .sql file', () => {
    const { entries } = loadJournal();
    const sqlFileCount = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).length;
    expect(entries.length).toBe(sqlFileCount);
  });

  it('has sequential idx starting at 0', () => {
    const { entries } = loadJournal();
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
    });
  });

  it('has strictly increasing when timestamps in array order', () => {
    const { entries } = loadJournal();
    for (let i = 0; i < entries.length - 1; i++) {
      expect(entries[i + 1].when).toBeGreaterThan(entries[i].when);
    }
  });

  it('every entry has a matching .sql file', () => {
    const { entries } = loadJournal();
    for (const entry of entries) {
      expect(() => loadMigrationSql(entry.tag)).not.toThrow();
    }
  });

  describe('idempotency guards', () => {
    const { entries } = loadJournal();

    it.each(entries.map((e) => e.tag))('%s has no unguarded DDL statements', (tag) => {
      const sql = loadMigrationSql(tag);
      for (const { name, pattern } of UNGUARDED_PATTERNS) {
        expect(pattern.test(sql), `${tag}: ${name}`).toBe(false);
      }
      expect(countUnguardedConstraints(sql), `${tag}: ADD CONSTRAINT missing DO $$ guard`).toBe(0);
    });
  });
});
