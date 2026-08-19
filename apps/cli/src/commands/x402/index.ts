// Implements: ADR-0092
import { Command } from 'commander';

import { x402PaymentsCommand } from './payments.js';
import { x402PolicyCommand } from './policy.js';
import { x402RequestCommand } from './request.js';

export const x402Command = new Command('x402').description(
  'Pay external x402 services with local spending policies'
);

x402Command.addCommand(x402RequestCommand);
x402Command.addCommand(x402PolicyCommand);
x402Command.addCommand(x402PaymentsCommand);
