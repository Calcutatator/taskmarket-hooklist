# 0061 — A reused idempotency key with different arguments is refused

> **Decision (Y-statement):** In the context of a relayed write whose idempotency key names an
> intent that already exists, facing a caller who re-sends that key with different arguments and is
> handed the earlier write reported as their own, we decided to compare the stored payload against
> the incoming one under a canonical form and refuse a mismatch with its own reason, to achieve a
> retry that either repeats the write it names or says plainly that it did not, accepting that the
> comparison is now on the recovery path and that a payload which cannot be reproduced byte-for-byte
> across attempts must be made reproducible before it can be compared.

- **Status:** Accepted
- **Date:** 2026-08-04
- **Accepted:** 2026-08-05
- **Embodiment:** Verified
- **Last audited:** 2026-08-04
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0052
- **Pending Amends / Amended-by:** —

## Context

ADR-0052 made a client-generated idempotency key mandatory on every relayed write. When
`recordRelayedIntent` finds the key already taken, it decides whether the stored intent may be
handed back to this caller as their own. That decision compares two things: the operation, and the
payer. It does not compare what the caller asked for.

So a request carrying a key that already exists, for the same operation, from the same payer, but
with a **different payload**, is answered with the earlier intent. The caller is told their write
succeeded. The arguments they sent are discarded, silently, and the write they described never
happens. Nothing in the response distinguishes that from a genuine retry.

**This is reachable without a broken client, and the path that reaches it is one we published.**
`TASKMARKET_IDEMPOTENCY_KEY` is documented in `docs/CLI_GUIDE.md` as the recovery mechanism: a
relayed write fails, the operator reads the key off the failure envelope, and re-runs the command
with that key set so the retry joins the original write instead of starting a second one. An
operator doing exactly that, who also corrects a flag — a reward they now know was wrong, a
different task id — gets the first operation's intent back and believes the second happened. The
recovery instruction and the defect are the same instruction.

It is worth being precise about what is wrong here, because "return the original" is a defensible
reading of idempotency and is what several well-known APIs do. The problem is not that the original
is returned; it is that nothing tells the caller their arguments were ignored. A caller who gets the
original *and knows it* can reconcile. A caller who gets the original *and is told it is the result
of the request they just made* cannot, and has no reason to look.

**Two constraints shape how the comparison has to be built.**

First, the stored side has been through `jsonb`. Key insertion order is gone, an entry whose value
was `undefined` was dropped rather than stored as null, a `Date` came back as a string. A naive
deep-equality check against the incoming object would find a difference on the first honest retry.

Second — and this is what turned out to matter most — several payloads were not reproducible across
attempts even in principle. `claims.claim` mints `claimId` with `randomUUID()` per request;
`submissions.submit` does the same for `submissionId` and for every artifact row's id, and the
artifact storage keys hang off `submissionId`. Both are free relayed writes, so they reach
`recordRelayedIntent` with a repeated key rather than being turned away by the pre-settlement check
in the payment middleware. Comparing their payloads as they stood would have refused every genuine
retry of the two operations most likely to be retried. A guard that breaks the recovery path is a
worse outcome than the silent wrong answer it was added to prevent.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Compare the canonicalised payload and refuse a mismatch with its own reason (selected) | The caller is never told a write happened when it did not; the two remedies — retry the original, or mint a fresh key — are opposite, and a distinct reason is what lets a client tell which one applies without reading prose; the check is one predicate in one place, on a path that already reads the stored row | The comparison is now on the recovery path, so a canonicalisation bug rejects legitimate retries — the failure it introduces is worse than the one it fixes; it forces server-minted payload ids to become derived rather than random, which is a real change to two routers; a caller whose payload legitimately varies for reasons we have not anticipated has no escape hatch |
| Leave it (rejected) | Nothing to build, nothing to get wrong, no new way to refuse a retry | The documented recovery path returns a wrong answer with a success status. Of every failure mode in this subsystem this is the only one that reports a write as done when it did not happen — every other one at least errors. The cost of the bug is unbounded because nobody looks for it |
| Return the original anyway and document it as the intended semantics (rejected) | Defensible on its own terms: the key *names* an operation, and ADR-0050's model is verbatim replay of what was authorised, so "the key wins over the body" is coherent and is what Stripe does. Zero implementation risk, and no chance of refusing an honest retry | It only works if the caller knows the rule, and our own documentation actively teaches the behaviour that violates it — we tell operators to reuse a key on a re-run, and a re-run is exactly where flags get corrected. Documenting it would mean documenting "and if you change any argument, we will lie to you". Stripe can hold this line because it returns the *original response body*, so a caller can see what they actually got; we return no body at all (see the next row), so our version of the rule has no observable half |
| Replay a completed intent's stored result on a repeated key (rejected, for now) | The best answer to the whole family: a retry gets the original outcome, verbatim, and a mismatch becomes visible rather than needing to be inferred. ADR-0058 already names it as the better answer | ADR-0058 declined it for want of anywhere to store a response body, and that is still true — there is no column, and adding one is a schema and a serialisation decision of its own. It also does not remove the need for this decision: a *pending* intent has no stored result to replay, and that is precisely the state a dropped-connection retry lands on. It is a strictly larger change that this one does not foreclose |
| Compare the payload but exclude a declared per-operation list of server-minted fields (rejected) | No router changes; the two nondeterministic payloads keep working immediately | The exclusion list is a second thing to keep in step with every payload, with no mechanism to notice when it drifts — and every field on it is a field the guard no longer looks at. For `submissions.submit` the excluded set would have had to include the whole `artifacts` array, which is most of what the payload *is*, leaving a guard that checks almost nothing on the operation where arguments differ most |
| Scope the check to paid writes only (rejected) | The nondeterministic payloads are both free writes, so the router changes disappear | Backwards: on a paid path the pre-settlement check in the payment middleware already refuses any repeated key before the handler runs, so the comparison would be dead code exactly where it was scoped to live, and absent exactly where it is reachable. It also reintroduces "is this path payer-gated?" as a criterion for how a relayed write behaves, which ADR-0050 ruled out |

## Decision

**1. A repeated key whose payload differs is refused, not answered with the earlier intent.** When
`recordRelayedIntent` finds an existing intent for the key, and that intent matches on operation and
payer, it now also compares payloads. Equal, and the existing intent is returned as before — that
path is unchanged and is the mechanism working. Different, and the request is refused.

**2. The refusal carries its own reason, `idempotency_key_payload_mismatch`.** It is not folded into
`idempotency_key_conflict`. That reason means "this key is bound to a different operation, there is
nothing here that is yours"; this is the same idea one level finer — the same operation, the same
caller, different arguments — and the correct client response differs. Under
`idempotency_key_conflict` the only remedy is a fresh key. Here there are two, and only the caller
knows which applies: re-send the arguments the write was created with to retry it, or mint a fresh
key for a genuinely new write. A reason a client cannot act on differently is not worth
distinguishing; this one is, so the message states both remedies explicitly rather than leaving the
caller to guess which write they meant.

**3. The comparison is canonical, and the canonical form is defined as "what the storage does to
it".** Both sides are put through the same trip the payload takes into `jsonb`, and only then
compared:

- Object keys are sorted recursively. `jsonb` does not preserve insertion order.
- **A key present with value `undefined` is treated as identical to an absent key.** This is the
  explicit choice, and it goes this way because the storage has already made it: `JSON.stringify`
  drops such entries, so `jsonb` cannot hold the distinction. Preserving it would mean a payload
  could never compare equal to its own stored copy. Inside an array the same value becomes `null`,
  again matching the storage.
- A `bigint` becomes its decimal string. `JSON.stringify` throws on one, so no intent was ever
  stored holding one — normalising rather than throwing keeps a caller passing a `bigint` where a
  numeric string is stored comparing equal, and it is also why wide integers are safe: the one
  realistic way a value above 2^53 reaches a payload is as a `bigint`, and as a string it round-trips
  exactly where a JSON number would not.

The property that matters is that the canonical form is a **fixed point of the round trip**, and it
is asserted against a payload that has actually made that trip rather than against a second
in-memory object.

**4. Server-minted payload identifiers are derived from the caller's key, not random.** `claimId`
in `claims.claim`, and `submissionId` plus every artifact id in `submissions.submit`, are now
derived through `derivedIdempotencyKey` from the request's own idempotency key, the same primitive
ADR-0052 point 8 already uses for server-originated intents.

This is part of the decision rather than an implementation detail, because without it the decision
is unsafe: those are free writes, they reach the comparison, and a fresh id per attempt would make
every honest retry of them look like a change of arguments. It also fixes a defect that predates
this ADR — a retried `claims.claim` returned the caller a `claimId` freshly minted for that attempt,
which is not the id the completion handler wrote. The general rule it establishes: **a relayed
payload must be a pure function of the request.** That is the same property ADR-0060 required of a
broadcaster, applied one step earlier, and it is what makes the payload comparable at all.

**5. This amends ADR-0052 and does not violate its point 1.** Point 1 says the backend never parses
the key: stored verbatim, matched by equality, no meaning derived from the value. That still holds
exactly. **The key remains opaque; it is the payload that is being compared.** Nothing here reads,
decomposes or interprets the key — the comparison operates on a different field entirely, and the
key's role is unchanged: it is what selects the row to compare against.

## Consequences

**Positive:**

- The documented recovery path can no longer return a wrong result reported as a success. Every
  outcome is either the write the caller named or an error that says so.
- The two remedies are distinguishable by a field rather than by reading a sentence, which is what
  ADR-0058 asked of every error.
- Relayed payloads become pure functions of their request, which is a property worth having
  independently — it is what makes replay, comparison and reconciliation all mean the same thing.
- A retried `claims.claim` now returns the `claimId` that was actually written, rather than one
  minted for an attempt whose row nobody kept.

**Negative / trade-offs:**

- **The canonicalisation is now load-bearing on the recovery path.** If it ever reports a false
  difference, it rejects a retry that should have succeeded — which is a worse failure than the one
  being fixed, because it breaks recovery outright rather than answering it wrongly. The mitigation
  is that the canonical form is defined as the storage round trip and asserted to be a fixed point
  of it, but this is a place where a plausible-looking "improvement" can do real damage.
- A caller whose payload legitimately varies between attempts of one operation now has no way to
  say so. There is no override, and the only remedy is to make the payload reproducible. Any future
  payload that captures a server clock, a random value, or state read at request time will fail here
  rather than at review, and the failure will surface as a refused retry in production rather than
  as a test.
- Two routers changed behaviour to satisfy a check in a third place. The coupling is real and is not
  visible at either call site beyond a comment, so someone restoring `randomUUID()` for local
  reasons would reintroduce the false rejection without any test in those routers failing.
- One more reason in a closed set that every client's switch must cover, and one more 409 that a
  naive client will treat as an ordinary failure.
- An extra serialisation of both payloads on the conflict path. Off the hot path — it runs only when
  a key is already taken — but it is proportional to payload size, and `submissions.submit` payloads
  carry artifact manifests.

**Neutral / follow-up:**

- Replaying a completed intent's stored result remains the better answer to this whole family, and
  remains unbuilt for the reason ADR-0058 gave. This decision does not foreclose it: if a response
  body is ever stored, a matching payload can return the original result instead of a conflict, and
  a mismatching one still needs this refusal.
- Nothing enforces payload purity mechanically. ADR-0060 enforces the broadcaster half of the same
  property with a call-graph check; the payload-construction half stays a review responsibility, as
  ADR-0060 itself noted.
- The pre-settlement check in the payment middleware still refuses any repeated key before a paid
  handler runs, so on paid paths this comparison is reachable only through the free-write path or a
  direct service call. Whether the pre-settlement check should itself compare payloads — and
  therefore need the payload before settlement, which it does not have — is not decided here.

## References

- [ADR-0052 — Every relayed write carries a mandatory, client-generated, backend-opaque idempotency key](0052-every-relayed-write-carries-a-client-generated-idempotency-key.md)
- [ADR-0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [ADR-0058 — Every API error carries a machine-readable reason, and in-flight is a 409 rather than a 500](0058-every-api-error-carries-a-machine-readable-reason.md)
- [ADR-0060 — A relayed payload is sufficient, and a broadcaster is pure](0060-a-relayed-payload-is-sufficient-and-a-broadcaster-is-pure.md)
- `apps/backend/src/services/relayed-intents.ts` — `canonicalizeIntentPayload` and the comparison
- `packages/shared/src/schemas/api-error.schemas.ts` — `idempotency_key_payload_mismatch`
- `apps/backend/src/routers/claims.router.ts`, `apps/backend/src/routers/submissions.router.ts` —
  the derived payload identifiers
- `docs/CLI_GUIDE.md` — `TASKMARKET_IDEMPOTENCY_KEY`, the recovery path this defect sat on
