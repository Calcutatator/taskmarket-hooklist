# 0052 — Every relayed write carries a mandatory, client-generated, backend-opaque idempotency key

> **Decision (Y-statement):** In the context of relayed writes whose outcome outlives the request
> that started them, facing a caller whose connection drops before the response arrives and who
> therefore holds no handle to the thing they have already paid for, we decided to require a
> client-generated idempotency key on every relayed write — paid or free, no fallbacks and no
> per-operation exceptions — stored verbatim under a global unique constraint and claimed
> atomically before any chain call, to achieve a retry that is always safe and an outcome that is
> always askable-about, accepting that existing raw-REST callers break and that a globally unique
> key can be collided across callers.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0049; amended by ADR-0061; amended by ADR-0067; amended by ADR-0077
- **Pending Amends / Amended-by:** —

## Context

ADR-0045 made a relayed write a durable intent: the request reports progress, the intent owns the
outcome, and only confirmed on-chain evidence settles anything. ADR-0049 then said the intent id is
"the identifier a caller holds onto" and gave it a status surface to be asked about.

**The intent id cannot be the recovery handle, and this is the flaw that forces this decision.** It
is minted by the backend, inside `recordRelayedIntent`, and reaches the caller only in the response.
The case a recovery handle exists for is precisely the one where no response arrives: a dropped
connection, a proxy timeout, a client crash after the x402 payment settled. In that case the caller
has paid, an intent exists, work may be under way — and they hold nothing they can name it by. They
can neither retry safely nor ask what happened. An identifier that only exists after the risky part
is over cannot cover the risky part.

An idempotency key must therefore originate with the client, *before* the request, or it cannot
survive the case it exists for. That is not a new idea here; it is the property that already makes
the one working case work. Today a paid retry is idempotent because `recordRelayedIntent` keys on
the x402 payment transaction hash, and the payment hash is client-originated — the client signed the
authorization and knows the hash before the server does anything with it. The mechanism that works
today works for exactly this reason. This decision generalises that property rather than continuing
to special-case it.

**What the payment hash cannot cover.** It is only present on paid writes. Free relayed writes —
`claims.claim`, `submissions.submit`, `evaluations.finalizeVerdict`, and every free write added
later — have no key at all, so a retry after a dropped connection records a second intent and makes
a second chain call. ADR-0050 already established that "is this path payer-gated?" is the wrong
criterion for how a relayed write is treated; applying a payment-shaped idempotency mechanism to
paid paths only is the same mistake in a different place.

**Opaque and client-originated are two different axes, and both hold.** Client-originated is about
*who* mints the value and *when*. Opaque is about what the backend may do with it: store it
verbatim, match it by equality, never parse it or derive meaning from it. A key that encoded the
operation, the payer or a timestamp would invite server-side logic that reads it, and every such
reading is a place where two callers' notions of "the same operation" can drift apart.

**A second, live defect surfaced while writing this.** The existing payment-hash reuse has a hole:
two concurrent requests for the same payment both read the intent as `recorded`, both find it
unsent, and both call `send()`. A unique index stops a second *row*; it does nothing about a second
*transaction against one row*. Reading a status and then acting on it is not a claim, and the gap
between the read and the send is where a duplicate chain call lives. This is not hypothetical: it is
reachable by any client that retries on timeout while the original request is still running, which
is the ordinary behaviour of most HTTP clients.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Mandatory client-generated key on every relayed write, globally unique, claimed atomically before the chain call (selected) | One mechanism for every operation, so "is retrying this safe?" has one answer instead of one per endpoint; covers the dropped-connection case that the intent id structurally cannot; the key is a second handle for the status surface, available to a caller who never saw a response; a single conditional UPDATE closes the concurrent-send hole that no unique index can; the payment hash is freed to be what it always really was, a guard against one payment funding two writes | Breaks every existing raw-REST caller that does not send the header; a globally unique key can be claimed by another caller, so a collision has to be refused rather than resolved; one more thing a client must get right, and a client that reuses a key across genuinely different operations gets a confusing conflict |
| Optional key, falling back to the payment hash where present (rejected) | No breaking change; paid paths keep working exactly as today; clients adopt it at their own pace | An optional guarantee is not a guarantee. A caller cannot write "retrying is safe" into their client without knowing every endpoint honours it, so the property has to be checked per operation, which is what this decision exists to stop. It also leaves free writes with no key at all, and leaves us maintaining two mechanisms whose behaviours differ in ways nobody will remember |
| A fallback ladder of natural per-operation keys — payment hash, then authorization nonce, then a payload digest (rejected) | Nothing to break; every operation gets *some* key; reuses values already present on the request | Several mechanisms that each look slightly different and fail differently. A payload digest silently collapses two genuinely distinct writes that happen to be identical (two bids at the same price, two identical submissions), which is a wrong answer rather than a missing one. An authorization nonce is signed and therefore not freely regenerable, so a client cannot mint a fresh one to express "this really is a new operation". Worst of all, the caller cannot tell which rung of the ladder their request landed on, so they cannot reason about what a retry will do |
| `(payer, key)` composite uniqueness instead of global (rejected) | A caller cannot be affected by another caller's choice of key; collisions are impossible across payers; no need to refuse a key that resolves to somebody else's intent | `evaluations.finalizeVerdict` is permissionless and has no payer, so the payer column is NULL for those rows — and in Postgres a NULL in a unique constraint makes the row unique regardless, so the constraint silently stops guarding exactly the rows nobody is watching. A guard that quietly disengages for a subset of rows is worse than one that never existed, because the code reads as though it is protected. Adding a synthetic payer to make the composite work would be inventing an owner for a write that deliberately has none |
| Drop the payment-hash unique index now that a key exists (rejected) | One constraint instead of two; nothing to explain about which is the "real" mechanism | The two guard different things. The key catches a well-behaved retry; the index catches a buggy client that generates a *fresh* key while replaying a settled payment — the one case where the key mechanism is looking the other way. Losing it would make "one payment, two chain calls" reachable again through a client bug rather than a race |
| Check the key only where the intent is recorded, in the handler (rejected) | The check sits next to the thing it guards, in one place, with no database access needed at middleware level; free paths need nothing else | On a paid path the handler runs *after* x402 has settled, so a retry is challenged, signs a fresh authorization, pays, and only then learns it already had an intent. The chain call is deduplicated and the payment is not: the caller is charged twice and the second payment becomes an orphaned payment needing a refund. It would have looked like a working idempotency key in every test that only counted chain calls |
| Have the losing caller of a concurrent claim wait for the winner's result (rejected) | The duplicate request gets the real answer rather than an error; feels friendlier to a naive client | Holds a connection open for an outcome that may take the entire receipt window to arrive, at exactly the moment the system is under duplicate load. It also duplicates a mechanism that already exists and is better: the caller holds the intent id and their own key, and ADR-0049's status surface answers on both. A duplicate submission's correct answer is "this is already happening, here is the handle" |

## Decision

**1. Every relayed write that originates in a request carries an `X-Taskmarket-Idempotency-Key`
header, and it is mandatory.** A UUID the client generates per logical operation: the same value on
every retry of that operation, a fresh value for a new one. Missing or malformed is a 400. No
fallback to the payment hash, no per-operation exception, no "paid paths only" — an optional
guarantee cannot be relied on, and a guarantee that holds for some operations has to be looked up
rather than known.

The qualifier is about *who the client is*, not about which operations are covered. A relayed write
with no caller to take a key from — one a completion handler records as follow-on work — still
carries a key, and point 8 says where that key comes from. Every relayed write has one; only
request-originated ones take it from a header.

The key is validated for UUID *shape* and nothing else. That is a check on form, not a reading of
content: nothing is parsed out of the value, and it is stored and compared exactly as sent. It earns
its place because the column is globally unique — a caller sending `1` would be staking a claim on a
name any other caller might also pick.

**2. This breaks existing raw-REST callers, and that is accepted.** Any client not sending the
header stops working on relayed writes. Raw REST against these endpoints is barely used, and the CLI
and web app are ours to update. The alternative — making it optional to avoid the break — gives up
the property the decision exists to establish. A break that is loud, immediate and fixed by adding
one header is a better trade than a guarantee nobody can depend on.

**3. The key is stored verbatim under a global unique constraint, not scoped to the payer.**
`evaluations.finalizeVerdict` is permissionless and has no payer; a NULL payer in a composite unique
constraint makes each such row trivially unique and the constraint stops guarding them, silently.
Global uniqueness has one consequence that must be handled rather than ignored: a key can resolve to
an intent belonging to somebody else. Such a request is **refused**, never answered with the other
caller's intent — returning it would leak a payer address, an amount and a payment hash, and would
report someone else's write as the caller's own.

**4. `payment_tx_hash` keeps its unique constraint and loses its job title.** It is no longer
described as the idempotency key. It is a distinct backstop with one narrow meaning: *one settled
payment funds at most one intent*. The mandatory key handles the well-behaved retry; the constraint
catches a client that generates a fresh key while reusing a payment it has already spent — precisely
the case the key mechanism cannot see, because from the key's point of view that is a new operation.

**5. On a paid path the key is checked before settlement, not in the handler.** This is part of
the decision, not an implementation detail, and it is the difference between the key working and
the key appearing to work.

x402 settles in middleware, before any handler runs. A key consulted where the intent is recorded
is therefore consulted *after* the caller has paid. A retry carrying the original key would be
issued a 402 challenge (the middleware knowing nothing about idempotency), sign a fresh
authorization, have it settled by the facilitator, and only then reach a handler that says "you
already have an intent for this". No second chain call — and a second settled payment, with nothing
to attach to, which becomes an orphaned payment needing a refund. **That is the double charge the
key exists to prevent, moved one layer up rather than removed.** A key checked after settlement is
not an idempotency key; it is a deduplicator for chain calls.

So the check runs ahead of the challenge, inside the payment middleware itself rather than as a
separate middleware mounted beside it — the ordering is what makes it correct, and two things that
must run in a particular order are safer in one function than in a mount list somebody can extend.
A *missing* key is rejected there for the same reason: let it through and the caller pays, then
receives a 400 for a payment that bought nothing.

The pre-settlement answer deliberately carries no payment facts. It runs before any caller is
authenticated — on the challenge round there is not even a payment payload to read a payer from —
so it can say the key is spoken for and nothing more. What happened to the write is read from the
payer-scoped status surface, which is exactly what that surface is for.

**6. The right to send is claimed atomically, not inferred from a status read.** Before any chain
call, a request takes the intent with a single conditional UPDATE — the same shape
`claimIntentForCompletion` already uses — so exactly one caller proceeds. This closes a live defect:
two concurrent requests for one intent could both read it as `recorded` and both call `send()`,
because a unique index stops a second row and nothing stopped a second transaction against one row.

**The losing caller is told the operation is in flight; it does not wait for the winner.** It
receives a conflict naming the intent and its status, and is directed to the status surface. Waiting
would hold a connection for an outcome that can take the whole receipt window to arrive, in order to
deliver an answer the caller can already obtain — they hold the intent id and their own key, and
both resolve on the status surface. "This is already happening, here is the handle" is the correct
answer to a duplicate submission; a blocked socket is not.

**7. Intent status is readable by intent id or by idempotency key.** This builds ADR-0049 point 2,
which was decided and never built, and extends it: the key is a lookup handle as well as a write
guard. That is the case that matters most — a caller whose connection dropped never learned the
intent id, and the key is the only thing they still hold. The surface reports operation kind,
status, transaction hash where known, terminal reason where failed, and refund state where the
intent carried a payment. It is payer-scoped through the existing read-auth header (ADR-0023), and a
request that is not the payer's receives exactly what a request for a non-existent id receives.

**8. Server-originated intents derive their key; they do not get a random one.** A few intents are
recorded by a completion handler as follow-on work — an evaluator assignment after a task creation,
a deliverable anchor after a proof — and have no caller to take a key from. These derive a
deterministic key from the parent's identity. This is not a fallback; it is the same rule applied
where the "client" is our own completion handler. It also fixes a real defect: completion is
at-least-once by design (ADR-0045), so a handler rerun after a crash previously recorded a *second*
follow-on intent and made a second chain call for work already under way. A random key would
preserve that bug; a derived one collapses the rerun onto the same follow-on.

**9. Retry exhaustion consults the persisted deadline directly.** ADR-0050 said the attempt cap is
"belt and braces, not the governing rule", and that the `validBefore` deadline governs — but that
held only by arithmetic: `MAX_BROADCAST_ATTEMPTS = 20` against a 30-second grace happens to exceed a
300-second window. Lower the cap or raise the grace and the constant silently becomes the governing
bound, refunding an intent whose receipt was still valid. Exhaustion now reads `relay_valid_before`
in the query itself, so the deadline governs because the code consults it, not because a number was
generously chosen. The cap remains, bounding resource use rather than correctness, exactly as
ADR-0050 describes it.

## Consequences

**Positive:**

- A caller can retry any relayed write safely, without knowing which operation it is or whether it
  is paid. One rule, no lookup table.
- The dropped-connection case is covered for the first time: a caller who never received a response
  still holds a handle, can retry it without paying twice, and can ask what happened to it.
- One payment can no longer buy two chain calls through a concurrent retry — a live defect that no
  unique constraint could have closed.
- A retry of a paid write is not charged at all, rather than being charged and refunded. The
  orphaned-payment path stops being the ordinary consequence of a client timeout.
- A completion-handler rerun no longer duplicates its follow-on work.
- `payment_tx_hash`'s constraint means one thing instead of two, and that thing is stated.
- The retry deadline is enforced by consulting the deadline, so tuning the attempt cap can no longer
  change which bound governs.

**Negative / trade-offs:**

- A breaking change to every raw-REST caller of a relayed write. Accepted deliberately; see point 2.
- Clients gain a real obligation: generate a key, reuse it across retries of the same operation, and
  not across different ones. A client that regenerates per attempt silently loses the guarantee
  while appearing to comply.
- Global uniqueness means one caller's key choice can affect another's. A UUID makes accidental
  collision negligible, and a deliberate collision is refused rather than resolved, but the failure
  mode is a confusing conflict for the innocent party.
- The losing side of a concurrent claim gets an error rather than an answer, so a naive client that
  treats every conflict as failure will report a write that is in fact succeeding. This is the same
  hazard ADR-0049 point 3 already names, one layer up.
- One more mandatory header on every write path, and one more thing to get wrong in a new client.
- Every paid request now does one extra indexed read before it can be challenged, on the hot path
  of the most expensive endpoints.
- The ordering in point 5 is invisible at the call site. Someone tidying the payment middleware
  could move the check without knowing that its position, not its existence, is what makes it
  work. This is why the ordering is stated as part of the decision and asserted by a test, rather
  than left as a comment.
- **The recovery story is only fully reachable for a caller that chooses its own key.** The CLI
  mints one inside its transport and does not print it, so a CLI operator whose connection drops
  holds neither the intent id nor the key and still cannot ask what happened. The mechanism is
  there and the client does not yet expose it; surfacing the key in the CLI's error output is what
  closes that, and it is not done here.

**Neutral / follow-up:**

- This amends ADR-0049 rather than superseding it. Its decision is unchanged; point 1's claim that
  "the intent id is the identifier a caller holds onto" is refined — the id remains the identifier
  the *system* keys on, and the client's own key is what makes it reachable when the id never
  arrived.
- Retention is now a slightly sharper question than ADR-0049 left it. An idempotency key only
  protects against a duplicate while its row exists; pruning intents would turn a safe retry back
  into a second chain call. Nothing prunes them today.
- Whether the status surface should also report retry state (how many rebroadcasts, when the receipt
  expires) is left where ADR-0050 left it: a natural extension, not decided here.
- Alerting on intents that exhaust their bound remains unbuilt, as it was after ADR-0047, ADR-0048
  and ADR-0050.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface, not `pendingActions`](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [ADR-0023 — Converge `agents.inbox` and `bids.myBids` self-auth onto the general read-auth header](0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- `apps/backend/src/services/relayed-intents.ts` — `recordRelayedIntent`, the key's validation and
  the two unique indexes it interprets
- `apps/backend/src/middleware/x402.ts` — the pre-settlement check, and why it sits where it does
- `apps/backend/src/services/relayed-intent-request.ts` — the atomic claim before the chain call
- `apps/backend/src/routers/intents.router.ts` — the payer-scoped status surface
- `apps/backend/drizzle/migrations/0042_add_relayed_intents.sql` — the column and its constraint
- `packages/shared/src/lib/authMessages.ts` — `IDEMPOTENCY_KEY_HEADER`
