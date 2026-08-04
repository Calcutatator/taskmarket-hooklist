// Driver for envelope-survives-a-pipe.test.ts. Run as a real child process with stderr wired to a
// pipe, because that is the only configuration where the bug it guards can happen at all: Node
// writes to files and TTYs synchronously and to pipes asynchronously, so a truncated envelope is
// invisible to any in-process test.
//
// The message is deliberately far larger than a pipe buffer. A short envelope can complete its
// write synchronously even on a pipe and would pass whether or not the renderer waits.
import { ApiError } from '../../../src/lib/api.js';
import { renderFailure } from '../../../src/lib/output.js';

// Measured, not guessed: a pipe buffer here is 64 KiB, and `process.exit` truncates to exactly
// that. Under 64 KiB nothing is lost either way and the test would pass on the broken renderer.
const padding = 'x'.repeat(4 * 1024 * 1024);

renderFailure(
  new ApiError(409, `POST failed after payment (409): still landing ${padding}`, 'key-abc', {
    reason: 'intent_in_flight',
    intentId: 'intent_123',
    intentStatus: 'broadcast',
    operation: 'tasks.rejectSubmission',
  })
);
