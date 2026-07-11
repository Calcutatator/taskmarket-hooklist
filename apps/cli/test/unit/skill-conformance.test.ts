import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { taskCommand } from '../../src/commands/task/index.js';

const repositoryRoot = path.resolve(process.cwd(), '../..');
const cliReference = readFileSync(
  path.join(repositoryRoot, 'apps/docs/src/public/reference/cli.md'),
  'utf8'
);

describe('shipped skill CLI conformance', () => {
  it('documents every live task command and no nonexistent commands', () => {
    const actualCommands = new Set(
      taskCommand.commands.flatMap((command) => [command.name(), ...command.aliases()])
    );
    const documentedCommands = new Set(
      [...cliReference.matchAll(/taskmarket task ([a-z][a-z-]*)/g)].map((match) => match[1])
    );

    expect([...documentedCommands].filter((command) => !actualCommands.has(command))).toEqual([]);
    expect([...actualCommands].filter((command) => !documentedCommands.has(command))).toEqual([]);
  });
});
