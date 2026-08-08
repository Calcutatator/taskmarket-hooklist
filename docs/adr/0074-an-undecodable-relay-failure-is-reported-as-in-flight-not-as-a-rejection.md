# 0074 — An undecodable relay failure is reported as in flight, not as a rejection

> **Decision (Y-statement):** In the context of a relayed write whose outcome the backend could
> not decode, facing a path that answered `400 Contract call rejected: unknown revert` for writes
> that went on to succeed, we decided to report every undecodable relay failure as ADR-0049's
> in-flight state and to stop encoding the retry verdict inside a user-facing revert string, to
> achieve a response that never asserts an outcome nobody established, accepting that a caller
> whose write genuinely did fail now learns so from settlement rather than from the request.

- **Status:** Accepted
- **Date:** 2026-08-08
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude (agent), directed by Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0049; amends ADR-0058
- **Pending Amends / Amended-by:** —

## Context

A sandbox smoke run submitted thirty intents. All thirty landed: thirty submission rows, thirty
completed intents. Two of them were nevertheless reported to the caller as failures, on both runs,
at the same thirty-second mark:

```
16:16:05.150  intent f2b9f1a7 created
16:16:35.277  HTTP 400 "Contract call rejected: unknown revert"
16:17:06.674  same intent COMPLETED, tx 0xb310ca12.., receipt status 1
```

The thirty seconds is the shape of `relayThroughForwarderResult`'s retry loop, not of anything
about the submission: six attempts, `RELAY_RETRY_DELAY_MS` apart, is a fixed wall-clock cost that
lands on the same mark every time. Both of that function's failure exits produced the same
sentence, and neither had grounds for it:

- The **replay exit**. A mined-but-failed receipt is replayed through `eth_call` to recover the
  revert reason. When the replay does not revert there is nothing to decode, and `revertReason`
  stayed at a literal `'unknown revert'` that was then formatted into `Contract call rejected:`.
- The **exhaustion exit**. Six attempts producing no decodable answer left `decodeRelayRevert`
  returning the same `'unknown revert'`, formatted into the same sentence.

In both cases the backend had established nothing. It said the chain had refused the caller.

`'unknown revert'` was also doing a second, unrelated job. `classifyRelayFailure` read it as the
token meaning **transient — retry this**, and the comments around the replay block record what
that cost: a permanent failure arriving by that path was indistinguishable from a retryable one
and got retried until it aged out. One string cannot mean both "the contract's stated reason" and
"we have no verdict"; every reader of it was reading someone else's meaning.

Separately and on a different surface, raw-REST validation had no envelope at all. A `POST` with
`evaluatorFeeBps: 10001` was correctly refused, with the body `{"error":"Number must be less than
or equal to 10000"}` — no field name, no `reason`, no `taskmarket` envelope. `apps/backend/src/
trpc.ts` applies the envelope in its tRPC error formatter and states the principle: "'every error
carries a discriminator' is only worth anything if it has no exceptions -- a caller that has to
test whether the field is present before branching on it is back to reading the message when it is
absent." `validateBody` is Express middleware and never reached that formatter, so ADR-0058 had a
hole in it on exactly the surface with no tRPC client to paper over the difference.

## Considered options

| Option                                                                                   | Pros                                                                                                                                                                                       | Cons                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Report an undecodable relay failure as in flight** (chosen)                            | The honest answer: nothing was established, so nothing is asserted. Reuses ADR-0049's existing third state and `intent_in_flight` envelope, so clients need no new branch. Fails safe — a caller told to poll never pays twice. | A genuinely failed write is now reported as in flight until settlement reaches it, so the caller waits rather than learning immediately. |
| Keep the 400, change only the wording (rejected)                                          | Smallest possible diff. Preserves the immediate answer for real failures.                                                                                                                    | Still a failure verdict on evidence that does not support one, and a 4xx still tells the caller *they* did something wrong. Leaves `unknown revert` classifier-token double duty untouched. |
| Make the message truthful but leave classification reading it (rejected)                  | Fixes the untrue prose without touching control flow.                                                                                                                                        | Keeps the coupling that caused the retry-until-aged-out bug: any future rewording of the string silently re-classifies every failure carrying it. |
| Block until settlement answers, then return the real outcome (rejected)                   | The caller gets a true terminal answer in one round trip.                                                                                                                                    | Holds a connection for the whole receipt window to deliver an answer `intents.get` already gives — the same argument ADR-0049 used to reject waiting for the duplicate-submission loser. |
| Give raw-REST validation its own new reason (rejected)                                    | Names the surface precisely.                                                                                                                                                                 | A new member of a closed shared union for a case an existing member already describes exactly; every client's switch grows for no new information. |
| Answer raw-REST validation with `unclassified` (rejected)                                 | Technically satisfies "every error carries a reason". No judgement call.                                                                                                                     | Withholds the one thing worth knowing on a paid route — that this was refused *before* the 402 challenge, so nothing was charged. Saying "no idea" when we do know is its own small untruth (ADR-0070). |

## Decision

A relayed write whose outcome the backend could not decode is reported as in flight, never as a
rejection, and the verdict "no outcome was established" is carried by a type rather than by a
string inside a user-facing message.

Concretely:

1. `decodeRelayRevert` returns `null` where it previously returned `'unknown revert'`. Absence of
   a reason is an absence; each caller says in its own words what it does about one.
2. Both failure exits of `relayThroughForwarderResult` raise `UndeterminedRelayError` when nothing
   decoded. It carries the transaction hash where one is known, and no hash where none was seen —
   which is not evidence that none exists (ADR-0069).
3. `classifyRelayFailure` reads `UndeterminedRelayError` as `transient` from the type. The
   `'unknown revert'` special case is gone: the `contract call rejected: ` prefix now appears only
   in front of a reason that was actually decoded, which makes it deterministic with no further
   test.
4. `runRelayedIntent` answers `UndeterminedRelayError` with the `intent_in_flight` envelope — the
   same answer a receipt timeout already produces — carrying the intent id, the operation, the
   idempotency key, and the hash when there is one. HTTP 409, per ADR-0058's reason-to-status map.
   The rebroadcast path records a hash rather than re-sending under it, and the orphaned-payment
   path refuses to treat it as the confirmed failure a refund requires (ADR-0045, ADR-0048).
5. Raw-REST validation failures answer with the `apiErrorBody` envelope under
   `reason: 'payment_preflight_rejected'` — "a pre-settlement check on the request's own inputs or
   on task state rejected it", which is exactly and only what `validateBody` is, since these routes
   mount it ahead of the x402 middleware. The offending field name goes in the message
   (`evaluatorFeeBps: Number must be less than or equal to 10000`) rather than into a new envelope
   field, because the envelope's shape is a shared contract and one middleware's convenience is not
   a reason to widen it.

## Consequences

**Positive:**

- No response asserts a rejection nobody observed. ADR-0070's rule now holds on the two exits that
  broke it.
- A write still landing is answered with the handle and the instruction to poll, so a caller
  following the documented rule cannot be led into a second paid submission of live work.
- The retry verdict and the user-facing reason are separate values with separate types. Rewording
  either can no longer silently change the other's meaning.
- Every raw-REST error carries the discriminator, so a client's switch on `reason` is total across
  all three transports rather than across two of them.

**Negative / trade-offs:**

- A write that genuinely failed with an undecodable revert is now reported as in flight. The caller
  waits for settlement instead of getting an immediate verdict. This is the deliberate direction:
  ADR-0047 already argues the asymmetry, and being wrong toward "poll" costs a delay while being
  wrong toward "failed" costs a duplicate payment.
- `payment_preflight_rejected` now covers both schema validation and semantic preflight checks. A
  caller wanting to tell those apart reads the message.

**Neutral / follow-up:**

- The thirty-second signature is diagnostic, not fixed here. `RELAY_MAX_RETRIES` and
  `RELAY_RETRY_DELAY_MS` still bound a request at roughly thirty seconds before it gives up; whether
  that budget is right is a separate question this ADR does not answer.

## References

- [ADR-0045 — relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0050 — durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [ADR-0047 — evaluator assignment is its own intent](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0048 — orphaning a payment is decided only by intent settlement](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0049 — in-flight paid writes are observable through a dedicated intent status surface](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0058 — every API error carries a machine-readable reason](0058-every-api-error-carries-a-machine-readable-reason.md)
- [ADR-0069 — the outbox row is the intent's evidence that a nonce was spent](0069-the-outbox-row-is-the-intents-evidence-that-a-nonce-was-spent.md)
- [ADR-0070 — a reason that asserts a fact carries it](0070-a-reason-that-asserts-a-fact-carries-it.md)
