// Implements: ADR-0047
import { BaseError, ContractFunctionRevertedError } from 'viem';

/**
 * Whether a failed relay attempt is worth trying again.
 *
 * `deterministic` means the chain (or the forwarder in front of it) rejected the call on its
 * own terms -- a revert. The inputs and the on-chain state that produced it are not going to
 * change by waiting, so a retry burns a nonce and an RPC round trip to reach the identical
 * answer. `transient` means the attempt never got a verdict out of the chain at all: a
 * provider timed out, throttled us, or dropped the connection.
 */
export type RelayFailureKind = 'deterministic' | 'transient';

/**
 * A relay attempt refused by our own code, on grounds that waiting cannot change.
 *
 * The classifier below reads "deterministic" out of the chain's own vocabulary, which means a
 * broadcaster that rejects its persisted payload before ever building a transaction has no way
 * to say so: a plain `Error` falls through to the `transient` default and the reconciler retries
 * an intent that can only ever be refused again -- ADR-0047's unbounded loop, reached without
 * the chain being involved at all. This class is how a broadcaster states the verdict itself.
 *
 * Only for facts fixed in the payload. Anything that depends on on-chain state or on the
 * network must keep the default, because the default is the cheaper mistake.
 */
export class DeterministicRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterministicRelayError';
  }
}

/**
 * Text `services/contract.ts` puts in front of every decoded revert, and the value it uses
 * when it could not decode one. An undecodable failure is treated as transient: the retry
 * loop in `relayThroughForwarderResult` exhausts into this same message when the RPC never
 * answered, so "unknown revert" is at least as often a network story as a contract one, and
 * guessing deterministic there would fail intents that only needed a second attempt.
 */
const REVERT_PREFIX = 'contract call rejected: ';
const UNDECODED_REVERT = 'unknown revert';

/**
 * Classify a relay failure so a caller can tell "try again" from "this will never work".
 *
 * This is the same distinction ADR-0040 drew one layer down, where retrying a deterministic
 * revert advanced the nonce cache and stranded every later transaction behind the gap. The
 * intent layer needs it for a different reason: a follow-on intent left in `recorded` is
 * retried on every worker pass forever, so a permanent revert becomes an unbounded loop that
 * never surfaces as a failure to anybody.
 *
 * The default is `transient`. Marking an intent `failed` is terminal, and inventing that
 * verdict from an error we do not recognise would strand work that a retry would have
 * finished -- the more expensive mistake of the two.
 */
export function classifyRelayFailure(error: unknown): RelayFailureKind {
  // Checked before anything else: this is a verdict stated outright, not one inferred from a
  // message, so no amount of text matching below should be able to talk it back into a retry.
  if (error instanceof DeterministicRelayError) return 'deterministic';

  // A decoded revert carried by viem itself, e.g. from a simulate() that was never retried.
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return 'deterministic';
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // The revert prefix is what makes a failure deterministic: a decoded revert reason is a
  // verdict the contract stated in its own vocabulary. That vocabulary is not chosen to avoid
  // transport words -- `SubmissionRateLimited`, `EvaluatorTimeout`, `DeadlineExceeded` all read
  // like network trouble -- which is why the verdict is taken from the prefix's presence rather
  // than from anything found in the message text.
  const prefixAt = message.indexOf(REVERT_PREFIX);
  if (prefixAt !== -1) {
    const reason = message.slice(prefixAt + REVERT_PREFIX.length).trim();
    return reason.startsWith(UNDECODED_REVERT) ? 'transient' : 'deterministic';
  }

  // No decoded reason, so nothing has spoken for the contract and the transport is the only
  // thing left that could have. There is deliberately no list of transport substrings here:
  // every one of them would return the same verdict this line already returns, so a scan could
  // only ever agree with the default while implying that failing to match it meant something.
  // The two ways of *not* being transient are both handled above, by evidence rather than by
  // vocabulary -- a decoded revert, or a `DeterministicRelayError` stated outright.
  return 'transient';
}

/** The decoded revert name, where there is one, for recording against a failed intent. */
export function relayFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const prefixAt = message.toLowerCase().indexOf(REVERT_PREFIX);
  if (prefixAt !== -1) return message.slice(prefixAt + REVERT_PREFIX.length).trim();
  return message;
}
