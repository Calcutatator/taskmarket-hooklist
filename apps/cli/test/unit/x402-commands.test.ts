// Verifies: ADR-0092
import { describe, expect, it } from 'vitest';

import { x402Command } from '../../src/commands/x402/index.js';
import { x402PaymentsCommand } from '../../src/commands/x402/payments.js';
import { x402PolicyCommand } from '../../src/commands/x402/policy.js';
import { x402RequestCommand } from '../../src/commands/x402/request.js';

describe('external x402 CLI surface', () => {
  it('registers request, policy and payments under the x402 command', () => {
    expect(x402Command.commands.map((command) => command.name())).toEqual([
      'request',
      'policy',
      'payments',
    ]);
  });

  it('exposes only GET/POST request controls and protected header inputs', () => {
    const method = x402RequestCommand.options.find((option) => option.long === '--method');
    expect(method?.argChoices).toEqual(['GET', 'POST']);
    expect(x402RequestCommand.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        '--json',
        '--body-file',
        '--headers-file',
        '--header-env',
        '--output',
        '--non-interactive',
        '--policy',
      ])
    );
  });

  it('exposes the complete policy and recovery management commands', () => {
    expect(x402PolicyCommand.commands.map((command) => command.name())).toEqual([
      'init',
      'path',
      'show',
      'validate',
      'schema',
      'add',
      'remove',
      'enable',
      'disable',
    ]);
    expect(x402PaymentsCommand.commands.map((command) => command.name())).toEqual([
      'list',
      'get',
      'reconcile',
      'resolve',
    ]);
  });
});
