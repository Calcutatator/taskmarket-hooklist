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
 * A relay attempt that reached no verdict at all, stated outright rather than inferred.
 *
 * The sibling of `DeterministicRelayError`, for the opposite end of the same question. A relay
 * whose attempts all failed without a decodable revert, or whose failed receipt could not be
 * reproduced by a replay, has established nothing: the write may still be landing, and the
 * transaction under it -- if there is one -- is owned by settlement. Callers translate this into
 * ADR-0049's third state (`intent_in_flight`) rather than into a failure.
 *
 * `txHash` is present only when a transaction is known to exist. Its absence is not evidence
 * that none does; it means only that this code never saw a hash (ADR-0069).
 */
export class UndeterminedRelayError extends Error {
  readonly txHash?: `0x${string}`;

  constructor(message: string, txHash?: `0x${string}`) {
    super(message);
    this.name = 'UndeterminedRelayError';
    this.txHash = txHash;
  }
}

/**
 * Text `services/contract.ts` puts in front of a decoded revert, and only in front of one.
 *
 * The prefix used to do two jobs. It also fronted the string `unknown revert`, which
 * `services/contract.ts` produced whenever it could not decode a reason -- so one message both
 * told a caller "the contract rejected this call" and told this classifier "no verdict, retry".
 * Those are different facts, and neither reading was safe while they shared a string: the prose
 * asserted a rejection nothing had established (ADR-0070), and a permanent failure arriving with
 * an undecodable reason was retried until it aged out.
 *
 * They are separate now. A message carrying this prefix carries a reason that was actually
 * decoded, which makes it deterministic with no further test. An attempt that decoded nothing
 * does not use this prefix at all: it raises `UndeterminedRelayError`, which is transient by the
 * default below and says so in its own name rather than inside a revert reason.
 */
const REVERT_PREFIX = 'contract call rejected: ';

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

  // Also a verdict stated outright, and the one that must not be talked *into* a verdict: an
  // attempt that established nothing is retryable, and no text below may conclude otherwise.
  if (error instanceof UndeterminedRelayError) return 'transient';

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
  if (message.includes(REVERT_PREFIX)) return 'deterministic';

  // No decoded reason, so nothing has spoken for the contract and the transport is the only
  // thing left that could have. There is deliberately no list of transport substrings here:
  // every one of them would return the same verdict this line already returns, so a scan could
  // only ever agree with the default while implying that failing to match it meant something.
  // The two ways of *not* being transient are both handled above, by evidence rather than by
  // vocabulary -- a decoded revert, or a `DeterministicRelayError` stated outright. Reaching
  // here now means the same thing an `UndeterminedRelayError` says explicitly; the class exists
  // so a producer that *knows* it established nothing can say so instead of relying on this
  // default being read correctly by everything downstream.
  return 'transient';
}

/** The decoded revert name, where there is one, for recording against a failed intent. */
export function relayFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const prefixAt = message.toLowerCase().indexOf(REVERT_PREFIX);
  if (prefixAt !== -1) return message.slice(prefixAt + REVERT_PREFIX.length).trim();
  return message;
}
