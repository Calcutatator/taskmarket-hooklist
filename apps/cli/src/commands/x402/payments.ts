// Implements: ADR-0092
import { Command, Option } from 'commander';
import { createInterface } from 'readline';

import {
  getX402Payment,
  listX402Payments,
  resolveX402PaymentManually,
  type X402PaymentState,
} from '../../lib/x402-journal.js';
import { reconcileX402Payment } from '../../lib/x402-reconcile.js';
import { printResult } from '../../lib/output.js';

const PAYMENT_STATES: X402PaymentState[] = [
  'reserved',
  'approval_pending',
  'ready',
  'dispatched',
  'settled',
  'failed_before_dispatch',
  'unknown',
  'expired_unspent',
  'settled_amount_unknown',
  'manually_resolved',
];

async function confirmManualResolution(): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error('Manual resolution requires an interactive TTY');
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) =>
    readline.question(
      'Manual resolution changes local spending accounting. Type resolve to continue: ',
      resolve
    )
  );
  readline.close();
  return answer.trim().toLowerCase() === 'resolve';
}

export const x402PaymentsCommand = new Command('payments').description(
  'Inspect and reconcile external x402 payment records'
);

x402PaymentsCommand
  .command('list')
  .description('List current payment records')
  .addOption(new Option('--state <state>', 'Filter by state').choices(PAYMENT_STATES))
  .action(async (options: { state?: X402PaymentState }) => {
    const payments = await listX402Payments({ state: options.state });
    printResult({ payments });
  });

x402PaymentsCommand
  .command('get')
  .description('Get one payment record')
  .argument('<paymentId>', 'Payment id')
  .action(async (paymentId: string) => printResult(await getX402Payment(paymentId)));

x402PaymentsCommand
  .command('reconcile')
  .description('Reconcile a payment authorization against the configured chain')
  .argument('<paymentId>', 'Payment id')
  .action(async (paymentId: string) => printResult(await reconcileX402Payment(paymentId)));

x402PaymentsCommand
  .command('resolve')
  .description('Manually record an externally verified final amount')
  .argument('<paymentId>', 'Payment id')
  .requiredOption('--settled-amount <atomicUnits>', 'Final settled amount in atomic units')
  .requiredOption('--note <text>', 'Audit note describing the evidence')
  .option('--transaction <hash>', 'Settlement transaction hash')
  .action(
    async (
      paymentId: string,
      options: { settledAmount: string; note: string; transaction?: string }
    ) => {
      if (!(await confirmManualResolution())) throw new Error('Manual resolution was declined');
      const payment = await resolveX402PaymentManually({
        id: paymentId,
        settledAmount: options.settledAmount,
        transaction: options.transaction,
        note: options.note,
      });
      printResult(payment);
    }
  );
