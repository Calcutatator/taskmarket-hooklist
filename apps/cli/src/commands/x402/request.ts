// Implements: ADR-0092
import { Command, Option } from 'commander';
import { createInterface } from 'readline';

import { executeExternalX402Request } from '../../lib/external-x402-client.js';
import { loadExternalHeaders } from '../../lib/x402-http.js';
import { printResult } from '../../lib/output.js';

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function confirm(lines: string[]): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation requires a TTY; use --non-interactive with policy');
  }
  process.stderr.write(`${lines.join('\n')}\n`);
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) =>
    readline.question('Type yes to approve: ', resolve)
  );
  readline.close();
  return answer.trim().toLowerCase() === 'yes';
}

export const x402RequestCommand = new Command('request')
  .description('Request and pay for a direct external x402 HTTP resource')
  .argument('<url>', 'HTTPS resource URL')
  .addOption(new Option('--method <method>', 'HTTP method').choices(['GET', 'POST']).default('GET'))
  .option('--json <json>', 'Inline JSON POST body')
  .option('--body-file <path>', 'Read JSON POST body from a file')
  .option('--headers-file <path>', 'Read request headers from an owner-only JSON file')
  .option(
    '--header-env <header=ENV_VAR>',
    'Read one request header from an environment variable (repeatable)',
    collect,
    []
  )
  .option('--output <path>', 'Write response bytes to a new file')
  .option('--non-interactive', 'Authorize only through a persistent unattended policy rule')
  .option('--policy <ruleId>', 'Restrict authorization to one policy rule')
  .action(
    async (
      url: string,
      options: {
        method: string;
        json?: string;
        bodyFile?: string;
        headersFile?: string;
        headerEnv: string[];
        output?: string;
        nonInteractive?: boolean;
        policy?: string;
      }
    ) => {
      const headers = await loadExternalHeaders({
        headersFile: options.headersFile,
        headerEnv: options.headerEnv,
      });
      const result = await executeExternalX402Request({
        rawUrl: url,
        method: options.method,
        json: options.json,
        bodyFile: options.bodyFile,
        headers,
        outputPath: options.output,
        nonInteractive: options.nonInteractive,
        policyRuleId: options.policy,
        confirmPayment: (terms) =>
          confirm([
            'External x402 payment',
            `Resource: ${terms.method} ${terms.origin}${terms.pathname}`,
            `Scheme: ${terms.scheme}`,
            `Network: ${terms.network}`,
            `Asset: ${terms.asset}`,
            `Recipient: ${terms.payTo}`,
            `${terms.scheme === 'upto' ? 'Maximum authorization' : 'Exact charge'}: ${terms.authorizedAmount} atomic units`,
            `Policy: ${terms.policyRuleId ?? 'one-time interactive exception'}`,
          ]),
        confirmDirectApproval: (details) =>
          confirm([
            'Permit2 token approval',
            `Network: ${details.network}`,
            `Asset: ${details.asset}`,
            `Spender: ${details.spender}`,
            `Bounded allowance: ${details.allowance} atomic units`,
            `Estimated maximum gas: ${details.estimatedGasWei} wei`,
          ]),
      });
      printResult(result);
    }
  );
