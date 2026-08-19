// Implements: ADR-0092, ADR-0095
import { promises as fs } from 'fs';
import { Command } from 'commander';
import { createInterface } from 'readline';

import { printResult } from '../../lib/output.js';
import {
  X402_POLICY_JSON_SCHEMA,
  addX402PolicyRule,
  getX402PolicyPath,
  initializeX402Policy,
  loadX402Policy,
  removeX402PolicyRule,
  setX402PolicyRuleEnabled,
  type X402PolicyRule,
} from '../../lib/x402-policy.js';

async function confirmUnattendedRule(rule: X402PolicyRule): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Authorizing an unattended policy rule requires an interactive TTY');
  }
  process.stderr.write(
    `${[
      'Unattended x402 policy rule',
      `Rule id: ${rule.id}`,
      `Origin: ${rule.origin}${rule.pathPrefix}`,
      `Methods: ${rule.methods.join(', ')}`,
      ...rule.payments.map(
        (payment) =>
          `Payment: ${payment.scheme} ${payment.network} ${payment.asset} -> ${payment.payTo ?? '(any)'}, up to ${payment.maxPerPayment} per call, ${payment.spendWindow.max} per ${payment.spendWindow.seconds}s`
      ),
      'This rule authorizes payments with no confirmation at request time.',
    ].join('\n')}\n`
  );
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) =>
    readline.question('Type authorize to grant unattended spending: ', resolve)
  );
  readline.close();
  return answer.trim().toLowerCase() === 'authorize';
}

export const x402PolicyCommand = new Command('policy').description(
  'Manage local external x402 spending policy'
);

x402PolicyCommand
  .command('init')
  .description('Create a deny-all policy file')
  .action(async () => {
    const policy = await initializeX402Policy();
    printResult({ path: getX402PolicyPath(), policy });
  });

x402PolicyCommand
  .command('path')
  .description('Print the policy file path')
  .action(() => printResult({ path: getX402PolicyPath() }));

x402PolicyCommand
  .command('show')
  .description('Show the parsed policy')
  .action(async () => printResult(await loadX402Policy()));

x402PolicyCommand
  .command('validate')
  .description('Validate the policy file')
  .action(async () => {
    const policy = await loadX402Policy();
    printResult({ valid: true, version: policy.version, rules: policy.rules.length });
  });

x402PolicyCommand
  .command('schema')
  .description('Print the policy JSON Schema')
  .action(() => printResult(X402_POLICY_JSON_SCHEMA));

x402PolicyCommand
  .command('add')
  .description('Add one rule from a JSON file')
  .requiredOption('--rule-file <path>', 'JSON file containing one policy rule')
  .action(async (options: { ruleFile: string }) => {
    const rule = JSON.parse(await fs.readFile(options.ruleFile, 'utf8')) as unknown;
    const policy = await addX402PolicyRule(rule, getX402PolicyPath(), confirmUnattendedRule);
    printResult({ path: getX402PolicyPath(), policy });
  });

x402PolicyCommand
  .command('remove')
  .description('Remove a policy rule')
  .argument('<ruleId>', 'Rule id')
  .action(async (ruleId: string) => {
    const policy = await removeX402PolicyRule(ruleId);
    printResult({ path: getX402PolicyPath(), policy });
  });

for (const enabled of [true, false]) {
  x402PolicyCommand
    .command(enabled ? 'enable' : 'disable')
    .description(`${enabled ? 'Enable' : 'Disable'} a policy rule`)
    .argument('<ruleId>', 'Rule id')
    .action(async (ruleId: string) => {
      const policy = await setX402PolicyRuleEnabled(
        ruleId,
        enabled,
        getX402PolicyPath(),
        confirmUnattendedRule
      );
      printResult({ path: getX402PolicyPath(), policy });
    });
}
