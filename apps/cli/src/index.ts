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
import { isInFlightApiError } from '@taskmarket/shared';

import { ApiError } from './lib/api.js';
import { getCurrentIdempotencyKey, withIdempotencyScope } from './lib/idempotency.js';

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
    const error = err as Error;
    const status = error instanceof ApiError ? error.status : undefined;
    // The key travels on the ApiError raised by the transport that minted it; the fallback covers
    // a write that failed before or after the HTTP call (a signing error, say), which still went
    // out -- or may still go out -- under a key the operator needs to hold.
    const idempotencyKey =
      (error instanceof ApiError ? error.idempotencyKey : undefined) ?? getCurrentIdempotencyKey();
    // The classification the CLI could not previously make (ADR-0058). Every failure used to
    // render identically, so a script had no way to tell a write that is still landing from one
    // that was rejected -- which is why the guidance had to be a blanket "never auto-retry a paid
    // command". `pending` is the one field a script needs: true means the write may still
    // succeed, so re-running it is a second payment rather than a retry. Poll `intents.get` with
    // `intentId`, or with `idempotencyKey` when the response never arrived.
    //
    // Absent entirely when the backend sent no envelope, rather than defaulted to false: an
    // unclassified failure is not evidence that nothing is in flight, and a script reading a
    // manufactured `pending: false` would retry on exactly the outcome it must not.
    const envelope = error instanceof ApiError ? error.envelope : undefined;
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error: error.message,
        ...(status !== undefined ? { status } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        ...(envelope !== undefined ? { ...envelope, pending: isInFlightApiError(envelope) } : {}),
      }) + '\n'
    );
    process.exit(1);
  }
});
