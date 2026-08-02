#!/usr/bin/env node
// PreToolUse hook: blocks an Edit/Write/MultiEdit to a docs/adr/*.md file if the edit's new
// stated `Embodiment:` value disagrees with the computed value from real back-pointer evidence
// (packages/adr's own computeEmbodiment, via adr-audit.ts's summary.json) -- the enforcement
// backstop introduced by PR #370: an agent (or human) can still get this field wrong, but this hook
// makes that require an explicit, logged override rather than a silent, unnoticed edit.
//
// Prototype scope: single-file, single `old_string`/`new_string` replacement or a `content`
// write. MultiEdit's multiple edits are applied in order but only the Embodiment field itself is
// tracked -- this is not a general-purpose patch engine.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';

const EMBODIMENT_RE = /\*\*Embodiment:\*\*\s+(.+)/;
const RANK = { 'Not started': 0, Specified: 1, Implemented: 2, Verified: 3 };

function readStdin() {
  // fd 0 is stdin -- readFileSync blocks until EOF, which is exactly what a hook needs since
  // Claude Code writes the whole JSON payload and closes stdin before waiting on this process.
  return readFileSync(0, 'utf-8');
}

function allow(message) {
  if (message) console.error(message);
  process.exit(0);
}

function block(message) {
  console.error(message);
  process.exit(2);
}

function applyEdit(current, toolName, input) {
  if (toolName === 'Write') return input.content ?? '';
  if (toolName === 'Edit') {
    if (input.replace_all) return current.split(input.old_string).join(input.new_string);
    const idx = current.indexOf(input.old_string);
    if (idx === -1) return null; // can't reconstruct -- let the real tool call fail/succeed on its own
    return current.slice(0, idx) + input.new_string + current.slice(idx + input.old_string.length);
  }
  if (toolName === 'MultiEdit') {
    let result = current;
    for (const edit of input.edits ?? []) {
      const applied = applyEdit(result, 'Edit', edit);
      if (applied === null) return null;
      result = applied;
    }
    return result;
  }
  return null;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    allow(); // malformed stdin -- fail open, this is a prototype, not a security boundary
  }

  const { tool_name: toolName, tool_input: input, cwd } = payload;
  if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) allow();

  const filePath = input.file_path;
  if (!filePath || !/docs\/adr\/\d{4}-.*\.md$/.test(filePath)) allow();

  const repoRoot = process.env.CLAUDE_PROJECT_DIR || cwd;
  const absPath = filePath.startsWith('/') ? filePath : join(repoRoot, filePath);
  if (!existsSync(absPath)) allow(); // new ADR being created -- nothing to diff against yet

  const current = readFileSync(absPath, 'utf-8');
  const proposed = applyEdit(current, toolName, input);
  if (proposed === null) allow(); // couldn't reconstruct -- fail open, let the tool call itself surface any real error

  const oldStated = EMBODIMENT_RE.exec(current)?.[1]?.trim();
  const newStated = EMBODIMENT_RE.exec(proposed)?.[1]?.trim();
  if (!oldStated || !newStated || oldStated === newStated) allow();

  const number = relative(repoRoot, absPath).match(/(\d{4})-/)?.[1];
  if (!number) allow();

  // Explicit, named override -- mirrors adr-audit.ts --refresh's own --by/--force pattern rather
  // than a silent bypass. Logged to stderr either way so it's visible in the transcript.
  const override = process.env.ADR_HOOK_OVERRIDE;

  let summary;
  try {
    // tsx is only on packages/adr's own node_modules/.bin (pnpm per-package hoisting) -- run the
    // package's own script from its own directory rather than assuming a repo-root-visible tsx.
    execSync('npm run --silent adr-audit', { cwd: join(repoRoot, 'packages/adr'), stdio: 'pipe' });
    summary = JSON.parse(readFileSync(join(repoRoot, 'docs/adr-audit/summary.json'), 'utf-8'));
  } catch (e) {
    allow(`[adr-embodiment-hook] could not run adr-audit.ts to check computed evidence -- allowing edit through unchecked: ${e.message}`);
  }

  const entry = summary.adrs.find((a) => a.number === number);
  if (!entry) allow();

  const computedRank = RANK[entry.computed] ?? 0;
  const newRank = RANK[newStated] ?? 0;

  if (newRank === computedRank) allow();

  const direction = newRank > computedRank ? 'claims MORE than the evidence supports' : 'claims LESS than the evidence supports';
  const message =
    `[adr-embodiment-hook] ADR-${number}: new Embodiment "${newStated}" ${direction}.\n` +
    `  Computed from real back-pointers: "${entry.computed}" (${entry.specRefs} spec refs, ${entry.codeRefs} code refs, ${entry.testRefs} test refs)\n` +
    `  Run \`npx tsx packages/adr/adr-audit.ts\` yourself and check docs/adr-audit/summary.json if this looks wrong.\n` +
    `  To proceed anyway, set ADR_HOOK_OVERRIDE=<your name> and retry -- this will be logged, not silent.`;

  if (override) {
    console.error(`${message}\n  OVERRIDDEN by ADR_HOOK_OVERRIDE="${override}" -- proceeding.`);
    process.exit(0);
  }

  block(message);
}

main();
