import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError } from '../../lib/output.js';

export const evaluateCmd = new Command('evaluate')
  .description('Submit an evaluation verdict for a task in Review state')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--verdict <type>', 'Verdict: approve, reject, or partial')
  .option('--score <n>', 'Score 0-1000 (default: 1000)', '1000')
  .option('--confidence <n>', 'Confidence 0-1000 (default: 1000)', '1000')
  .option('--evidence-hash <hash>', 'Evidence hash (32-byte hex)')
  .option(
    '--award <worker:amount:rank>',
    'Award entry (repeatable): worker:amountUSDC:rank',
    collect,
    []
  )
  .action(
    async (
      taskId: string,
      opts: {
        verdict: string;
        score: string;
        confidence: string;
        evidenceHash?: string;
        award: string[];
      }
    ) => {
      const validVerdicts = ['approve', 'reject', 'partial'];
      if (!validVerdicts.includes(opts.verdict)) {
        return void printError(`--verdict must be one of: ${validVerdicts.join(', ')}`);
      }

      const awards: { worker: string; amount: string; rank: number }[] = [];
      for (const entry of opts.award) {
        const parts = entry.split(':');
        if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
          return void printError(
            `Invalid award format '${entry}'. Expected worker:amountUSDC:rank`
          );
        }
        const [worker, amountUSDC, rankStr] = parts;
        if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) {
          return void printError(
            `Invalid worker address in '${entry}': must be 0x-prefixed 40-char hex`
          );
        }
        const parsedAmount = Number(amountUSDC);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          return void printError(`Invalid amount in '${entry}': must be a positive number`);
        }
        const microUnits = Math.round(parsedAmount * 1e6);
        if (!Number.isFinite(microUnits) || microUnits > Number.MAX_SAFE_INTEGER) {
          return void printError(`Amount in '${entry}' is too large to convert to micro-units`);
        }
        const parsedRank = Number(rankStr);
        if (!Number.isInteger(parsedRank) || parsedRank < 1) {
          return void printError(`Invalid rank in '${entry}': must be a positive integer`);
        }
        awards.push({ worker, amount: String(microUnits), rank: parsedRank });
      }

      const body: Record<string, unknown> = {
        taskId,
        verdict: opts.verdict,
        score: parseInt(opts.score, 10),
        confidence: parseInt(opts.confidence, 10),
        awards,
      };

      if (opts.evidenceHash) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(opts.evidenceHash)) {
          return void printError(
            '--evidence-hash must be a 0x-prefixed 32-byte hex string (0x + 64 hex chars)'
          );
        }
        body.evidenceHash = opts.evidenceHash;
      }

      const result = (await x402Post(`/api/tasks/${taskId}/evaluate`, body)) as { txHash: string };
      printResult({ txHash: result.txHash });
    }
  );

function collect(val: string, prev: string[]): string[] {
  return prev.concat([val]);
}
