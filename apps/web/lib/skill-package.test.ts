import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const publicSkillDir = path.resolve(process.cwd(), '../docs/src/public');
const skillText = readFileSync(path.join(publicSkillDir, 'skill.md'), 'utf8');
const installerText = readFileSync(path.resolve(process.cwd(), 'public/install-skill.sh'), 'utf8');

function localMarkdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(((?:modes|reference|examples)\/[^)#]+\.md)(?:#[^)]+)?\)/g)].map(
    (match) => match[1]
  );
}

describe('Taskmarket skill package', () => {
  it('contains every local file linked by the root skill', () => {
    const links = localMarkdownLinks(skillText);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(path.join(publicSkillDir, link)), `missing ${link}`).toBe(true);
    }
  });

  it('downloads every local file linked by the root skill', () => {
    for (const link of localMarkdownLinks(skillText)) {
      expect(installerText, `installer omits ${link}`).toContain(link);
    }
  });
});
