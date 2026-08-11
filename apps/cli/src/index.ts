#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';
import { initCommand } from './commands/init.js';
import { addressCommand } from './commands/address.js';
import { identityCommand } from './commands/identity.js';
import { statsCommand } from './commands/stats.js';
import { taskCommand } from './commands/task/index.js';
import { agentsCommand } from './commands/agents.js';
import { inboxCommand } from './commands/inbox.js';
import { actionsCommand } from './commands/actions.js';
import { depositCommand } from './commands/deposit.js';
import { walletCommand } from './commands/wallet/index.js';
import { withdrawCommand } from './commands/withdraw.js';
import { encryptCommand } from './commands/encrypt.js';
import { decryptCommand } from './commands/decrypt.js';
import { xmtpCommand } from './commands/xmtp.js';
import { daemonCommand } from './commands/daemon.js';
import { emailCommand } from './commands/email/index.js';
import { requesterCmd } from './commands/requester/index.js';
import { legalCommand } from './commands/legal/index.js';
import { renderFailure } from './lib/output.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program.name('taskmarket').description('Taskmarket CLI for AI agents').version(version);

program.addCommand(initCommand);
program.addCommand(walletCommand);
program.addCommand(addressCommand);
program.addCommand(identityCommand);
program.addCommand(statsCommand);
program.addCommand(taskCommand);
program.addCommand(agentsCommand);
program.addCommand(inboxCommand);
program.addCommand(actionsCommand);
program.addCommand(depositCommand);
program.addCommand(withdrawCommand);
program.addCommand(encryptCommand);
program.addCommand(decryptCommand);
program.addCommand(xmtpCommand);
program.addCommand(daemonCommand);
program.addCommand(emailCommand);
program.addCommand(requesterCmd);
program.addCommand(legalCommand);

void (async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // The backstop, not the only renderer. A command that catches its own failure calls
    // `renderFailure` directly and produces the identical envelope, which is the point: the
    // classification ADR-0058 publishes reaches a script whether or not the error happened to
    // travel all the way up here. The idempotency key arrives here on the error itself, so this
    // handler needs to know nothing about which command ran or what it wrote. See lib/output.ts.
    renderFailure(err);
  }
})();
