# 0058 — Every API error carries a machine-readable reason, and in-flight is a 409 rather than a 500

> **Decision (Y-statement):** In the context of paid writes whose in-flight outcome ADR-0049
> required to be structurally distinguishable from a failure, facing clients that string-match
> backend prose because no such field was ever built, we decided to publish a closed
> `ApiErrorEnvelope` under `error.data.taskmarket` on every error — with `intent_in_flight`
> answering 409 rather than 5xx, and a structural test failing the build when a relayed-write path
> throws anything unclassified — to achieve a caller that can branch without reading a message,
> accepting that in-flight remains an error rather than becoming a 200 and that raw-REST callers
> see a status change on one path.

- **Status:** Proposed
- **Date:** 2026-08-04
- **Embodiment:** Verified
- **Last audited:** 2026-08-04
- **Author:** Claude Code (drafted for review)
- **Reviewers:** None recorded — drafted for review, no independent reviewer yet
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Pending amends ADR-0049

## Context

ADR-0049 point 3 says an in-flight result is "an identified, machine-readable state carrying the
intent id and status — not as a generic 500 whose prose must be parsed", and that "a caller
distinguishes the two by a field, never by string-matching a message."

That field was never built. `runRelayedIntent` rethrows `ServerTransactionPendingError` raw, so
the outcome reaches a client as an HTTP 500 with a sentence and nothing else. Every client has
since paid for the gap in a different currency:

- **The web app string-matches four literal substrings** (`apps/web/lib/relayed-write-outcome.ts`)
  to decide whether a failure is still landing. The file is careful, isolated and tested — its own
  comment explains that it errs toward missing rather than over-matching because the two ways of
  being wrong are not symmetric. It is the best available answer to a question the backend refused
  to answer, and a backend reword silently breaks it. The cost of getting it wrong is a user
  paying twice.
- **The CLI cannot distinguish it at all.** Every failure renders identically, which is why
  `docs/CLI_GUIDE.md` has to tell script authors never to auto-retry a paid command — a
  documentation-shaped patch over a missing field.
- **A repeated idempotency key answers 409 with prose.** That case is idempotency *working*, and
  it arrives at the client shaped like an error at the exact moment someone is deciding whether to
  pay again.

Two further facts made the problem worse than a single missing field. First, `INTERNAL_SERVER_ERROR`
carrying a sentence is not a contract: tRPC's `code` is coarse (`BAD_REQUEST` covers 104 throw
sites in this backend) and says nothing about *which* condition fired. Second, the x402 middleware
answers `res` directly, before any procedure runs, so its refusals never pass through tRPC's error
path at all — a paid write can be refused at two layers that shared no vocabulary.

None of this is fixed by writing it down. A convention that a discriminator "should" be attached
is exactly the convention ADR-0049 already established and that nothing honoured for the
subsequent five ADRs.

## Considered options

Three questions had to be answered, and each had a real alternative.

### 1. Where the discriminator lives

| Option | Pros | Cons |
| --- | --- | --- |
| A closed `reason` union in `@taskmarket/shared`, published on every error under `error.data.taskmarket` (selected) | One vocabulary for tRPC, raw REST and the x402 middleware; a client's switch is total because unclassified errors get `reason: 'unclassified'` rather than no field; the union is a compile-time surface, so adding a reason without choosing its status is a type error | A new shared surface to version; a client compiled against an older package sees a reason it cannot interpret |
| Reuse tRPC's `code` and add more codes (rejected) | No new field; existing clients already read `data.code` | tRPC's codes are a fixed HTTP-shaped set that cannot be extended, and they are transport facts, not domain facts. `CONFLICT` would still mean four different things |
| Per-endpoint typed error results in each output schema (rejected) | Fully typed per operation | Every relayed write's output schema becomes a union, which is precisely the shape that lets a client read an in-flight answer as a success — see question 2 |

### 2. Whether in-flight is still an error

This is the central decision.

| Option | Pros | Cons |
| --- | --- | --- |
| Remains a non-2xx error, coded `CONFLICT` (409), carrying the envelope (selected) | A client that ignores the new field keeps today's behaviour: degraded, but it still knows something went other than plainly right. 409 is not in the retry-me family, so a generic retrying HTTP client stops rather than paying again. Both doors onto the same fact — a write that went in flight, and a repeat of it arriving on its idempotency key — answer with one status distinguished by `reason`. No output schema changes, so the OpenAPI success shape of every paid endpoint is untouched | "Error" is not what an in-flight write is. ADR-0049 calls it a third outcome alongside success and failure, and a 4xx still reads as "you did something wrong" |
| 200 with an explicit outcome field (rejected) | The most honest description of the state: nothing failed, and saying so in the status is truer than any 4xx or 5xx | **A client that ignores the new field reads it as success.** That is the whole failure this work exists to prevent, reintroduced with a friendlier face: the two ways of being wrong are not symmetric, and a silent misread of "your task was created" is far worse than a loud error a client does not fully understand. It also forces every relayed write's output schema into a union, so `result.taskId` becomes `undefined` on a path 20-plus endpoints currently treat as always present, and every raw-REST caller's success shape changes at once |
| 202 Accepted (rejected as unreachable, not as wrong) | Semantically exact: the request was accepted, processing is not complete | No tRPC error code maps to 202, and both the tRPC adapter and `trpc-to-openapi` derive the status from that code. Reaching it would mean overriding the status outside the error path for one case, in both adapters — new machinery in the layer whose job is to be uniform. Recorded here so it is not re-proposed as if it had been overlooked |

The 200 option is the tempting one and it is rejected for one reason stated plainly: **a client
that ignores a new error field degrades loudly; a client that ignores a new success field degrades
silently.** ADR-0049 itself accepted the former — "a client that ignores the in-flight state
degrades to today's behaviour rather than failing loudly" is listed among its trade-offs, and that
sentence only makes sense if the outcome stays on the error path.

### 3. Whether a repeated idempotency key is still a 409

| Option | Pros | Cons |
| --- | --- | --- |
| 409 carrying `idempotency_key_reused` plus the existing intent's id and status (selected) | Answerable before the caller is authenticated, which is where the check must run — a repeat is rejected *ahead* of the 402 challenge so nothing is charged. Carries the intent status, so a client can tell a repeat of a write still landing from a repeat of one that already failed | A conflict status for the case where the mechanism worked exactly as designed reads as a failure to a naive client |
| 200 returning the original operation's result (rejected) | Textbook idempotent replay; the caller gets what they would have got | Only sound when the original *completed*. The check runs pre-authentication and pre-payment, and at that moment the original may be `recorded` (no result exists), `broadcast` (still no result) or `failed` (a 200 would report a failure as a success). It would also mean storing each operation's response body on the intent row, which nothing does today, and returning another party's result to whoever guessed their key |

The principled version of the rejected option — replay a *completed* intent's result, conflict on
anything else — is genuinely better and is recorded as follow-up rather than adopted, because it
needs the intent row to store what the operation returned. What is adopted now is the half that
costs nothing: the status is in the envelope, so a client can already tell the three cases apart.

### 4. Whether the rule is enforced or documented

| Option | Pros | Cons |
| --- | --- | --- |
| An AST test over the relayed-write path that fails the build on an unclassified throw (selected) | The same mechanism as `intent-payment-reference-usage.test.ts` and its neighbours, which work precisely because they are not review. A path that reaches a client with prose alone stops being expressible | Scoped to a file list, so a new file in the relayed-write path must be added to it |
| Document the convention (rejected) | No work | This is exactly what ADR-0049 did, and the result is this ADR |

## Decision

**1. There is one error envelope, and every error carries it.** `ApiErrorEnvelope` in
`packages/shared/src/schemas/api-error.schemas.ts` carries a `reason` from a closed union, plus
`intentId`, `intentStatus`, `operation`, `idempotencyKey` and `txHash` where each genuinely
applies. It is published at `error.data.taskmarket` on tRPC responses by an `errorFormatter`, and
beside `error` on the raw-REST and x402 middleware bodies. An error nobody classified still
carries `{ reason: 'unclassified' }`, so a client's switch is total and the field's absence is
never a case a caller has to model.

**2. `reason` decides the status, in one place.** `REASON_CODES` in
`apps/backend/src/lib/api-error.ts` is a `Record<ApiErrorReason, TRPCError['code']>`, so adding a
reason without choosing its status does not compile. A throw site names the fact; it does not pick
a transport detail.

**3. In flight stays an error and answers 409.** Not 5xx — nothing malfunctioned, and 5xx is what
a generic retrying client retries, which here means paying twice. Not 200 — a client that ignores
the field would read it as success, which is the failure this exists to prevent. `reason` is
`intent_in_flight`, and it carries the intent id, `intentStatus: 'broadcast'` and the transaction
hash. It remains, exactly as ADR-0049 states, no claim either way about whether the payment moved.

**4. A repeated idempotency key stays a 409, and now says which intent and what state it is in.**
`reason` is `idempotency_key_reused`. `isInFlightApiError` in shared treats it as in flight only
while the named intent is `recorded` or `broadcast`: a reused key naming a `failed` intent is a
settled failure and must read as one.

**5. The relayed-write path may not throw an unclassified error.**
`apps/backend/test/unit/config/api-error-envelope-usage.test.ts` walks the AST of
`services/relayed-intent-request.ts`, `services/relayed-intents.ts`, `services/intents/*.ts`,
`middleware/x402.ts` and `routers/intents.router.ts` and fails if any of them constructs a bare
`TRPCError`, and fails if `relayed-intent-request.ts` rethrows `ServerTransactionPendingError`
raw. It also asserts `REASON_CODES` is total over the shared union.

**6. Clients branch on `reason`, never on message text.** `isInFlightApiError` and
`apiErrorEnvelopeOf` are exported from shared so the web app and the CLI share one predicate
rather than each deciding for itself which reasons are non-terminal.

## Consequences

**Positive:**

- The four literal substrings in `apps/web/lib/relayed-write-outcome.ts` stop being the web app's
  only evidence, and a backend reword can no longer silently break a paid write's in-flight
  handling.
- The CLI can distinguish in-flight from failed for the first time, so `docs/CLI_GUIDE.md`'s
  blanket "never auto-retry a paid command" becomes a specific rule with a field behind it.
- A paid write refused by the x402 middleware and one refused inside a procedure now speak the
  same vocabulary, which they never did — one is Express, one is tRPC.
- 409 rather than 5xx means every off-the-shelf retrying HTTP client stops instead of paying
  again, without knowing anything about Taskmarket.
- The rule is enforced by a test rather than by review, which is the only form of this rule that
  has ever held in this repository.

**Negative / trade-offs:**

- In-flight is still delivered on the error path, which is not what it is. This is a deliberate
  choice of the less-bad misreading, not a claim that 4xx describes it well.
- One raw-REST status changes: an in-flight paid write was a 500 and is now a 409. Callers keying
  on the status class see a change, which is why it is in the OpenAPI spec and the raw-API
  reference in the same change.
- The shared reason union is now a versioned surface. A client built against an older package
  treats an unknown reason as no information, which is safe but degraded.
- The structural guard is scoped to a file list. A new relayed-write file that nobody adds to the
  list is unguarded — the same limitation the neighbouring guards carry.

**Neutral / follow-up:**

- **Replaying a completed intent's result** as a 200 rather than a 409 is the better answer for
  that one case and is not built. It needs the intent row to store the operation's response, which
  is a schema change and its own decision.
- The 402 body keeps its x402 fields exactly where they are and gains the envelope beside them, so
  a caller that only speaks x402 is unaffected.
- Reason coverage outside the relayed-write path is unenforced. The other 200-odd `TRPCError`
  throw sites publish `unclassified` and are correct-by-default; classifying them is incremental
  and needs no further decision.
- Whether the web app or the CLI *presents* in-flight state differently is not decided here. This
  settles what the API says.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0052 — Every relayed write carries a client-generated idempotency key](0052-every-relayed-write-carries-a-client-generated-idempotency-key.md)
- `packages/shared/src/schemas/api-error.schemas.ts` — the envelope and the closed reason union
- `apps/backend/src/lib/api-error.ts` — `apiError`, `REASON_CODES`, `envelopeForError`
- `apps/backend/test/unit/config/api-error-envelope-usage.test.ts` — the structural guard
- `apps/web/lib/relayed-write-outcome.ts` — the substring matching this replaces
