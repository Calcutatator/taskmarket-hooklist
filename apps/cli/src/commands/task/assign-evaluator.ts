import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError } from '../../lib/output.js';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const assignEvaluatorCmd = new Command('assign-evaluator')
  .description(
    'Assign an evaluator to an open, unclaimed task you requested (costs 0.001 USDC). ' +
      'Only possible before a worker claims the task.'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--evaluator <address>', 'Evaluator wallet address')
  .option('--evaluator-fee-bps <bps>', 'Evaluator fee in basis points, 0-10000 (default: 0)')
  .option('--evaluation-window <hours>', 'Hours the evaluator has to issue a verdict (default: 24)')
  .option('--appeal-window <hours>', 'Hours the worker has to appeal a verdict (default: 24)')
  .option('--dispute-resolver <address>', 'Address allowed to resolve an appealed verdict')
  .action(
    async (
      taskId: string,
      opts: {
        evaluator: string;
        evaluatorFeeBps?: string;
        evaluationWindow?: string;
        appealWindow?: string;
        disputeResolver?: string;
      }
    ) => {
      if (!ADDRESS_PATTERN.test(opts.evaluator)) {
        return void printError(`--evaluator must be a wallet address, got: ${opts.evaluator}`);
      }
      if (opts.disputeResolver !== undefined && !ADDRESS_PATTERN.test(opts.disputeResolver)) {
        return void printError(
          `--dispute-resolver must be a wallet address, got: ${opts.disputeResolver}`
        );
      }

      const body: Record<string, unknown> = { taskId, evaluator: opts.evaluator };

      if (opts.evaluatorFeeBps !== undefined) {
        const bps = Number(opts.evaluatorFeeBps);
        if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
          return void printError(
            `--evaluator-fee-bps must be an integer between 0 and 10000, got: ${opts.evaluatorFeeBps}`
          );
        }
        body.evaluatorFeeBps = bps;
      }

      if (opts.evaluationWindow !== undefined) {
        const hours = Number(opts.evaluationWindow);
        if (!Number.isFinite(hours) || hours <= 0) {
          return void printError(
            `--evaluation-window must be a positive number of hours, got: ${opts.evaluationWindow}`
          );
        }
        body.evaluationWindowHours = hours;
      }

      if (opts.appealWindow !== undefined) {
        const hours = Number(opts.appealWindow);
        if (!Number.isFinite(hours) || hours <= 0) {
          return void printError(
            `--appeal-window must be a positive number of hours, got: ${opts.appealWindow}`
          );
        }
        body.appealWindowHours = hours;
      }

      if (opts.disputeResolver !== undefined) {
        body.disputeResolver = opts.disputeResolver;
      }

      const { data: result, idempotencyKey } = await x402Post<Record<string, unknown>>(
        `/api/tasks/${taskId}/evaluator`,
        body
      );
      printResult(result, { idempotencyKey });
    }
  );
