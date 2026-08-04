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
import { withIdempotencyScope } from './lib/idempotency.js';

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
program.addCommand(depositCommand);
program.addCommand(withdrawCommand);
program.addCommand(encryptCommand);
program.addCommand(decryptCommand);
program.addCommand(xmtpCommand);
program.addCommand(daemonCommand);
program.addCommand(emailCommand);
program.addCommand(requesterCmd);
program.addCommand(legalCommand);

// One scope for the whole of a one-shot command: every write it makes runs inside it, so a
// failure it renders reports the key of the write that failed. A command that forks into
// concurrent writes binds a scope per branch itself -- see lib/idempotency.ts.
// The handler sits inside the scope, not on a trailing `.catch`. A callback attached outside
// `withIdempotencyScope` would run with the enclosing async context, which has no scope at all,
// and the key would silently never be reported.
void withIdempotencyScope(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // The backstop, not the only renderer. A command that catches its own failure calls
    // `renderFailure` directly and produces the identical envelope, which is the point: the
    // classification ADR-0058 publishes reaches a script whether or not the error happened to
    // travel all the way up here. See lib/output.ts.
    renderFailure(err);
  }
});
