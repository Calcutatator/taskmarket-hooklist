# 0007 — RPC efficiency and provider-load operating model

- **Status:** Draft
- **Date:** 2026-08-02
- **Author:** Agent — drafted for Beau's review
- **Supersedes / Superseded-by:** —

## Summary

Taskmarket currently mixes inexpensive database reads with live JSON-RPC reads in several public
request paths. A single task detail can make four contract calls, a connected clock-auction viewer
can repeat that work every five seconds, a Task Drop fans the same detail read out across every
task, every backend replica runs its own steady-state indexer, and the relay retries deterministic
contract reverts as if they were transient provider failures. This RFC proposes a staged RPC
operating model: instrument every runtime request through shared clients; remove UI- and
composition-driven amplification; cache immutable values indefinitely and mutable DREAMS settings
as one bounded snapshot; coalesce and rate-limit public reads; classify relay failures before
retrying; elect one steady-state indexer owner without weakening startup or checkpoint guarantees;
and require production-grade provider configuration. The proposal is intended to reduce provider
load without removing a user-visible capability, weakening transaction correctness, or disguising
usage by reducing freshness without an explicit budget.

## Motivation

### Current request-path accounting

The following figures are static request-path measurements from the code as of 2026-08-02. They
are not yet production traffic measurements; Tier 0 below adds the instrumentation needed to
measure real volume, latency and failure rates before enforcement or rollout decisions.

| Journey | Current JSON-RPC work | Amplification source |
| --- | ---: | --- |
| Task detail, no DREAMS hook configured | 1 `eth_call` | `getTaskHooks` is read on every request |
| Task detail, DREAMS hook configured | 4 `eth_call`s | Hook membership plus three independent DREAMS setting reads |
| Connected clock-auction viewer | 12 detail requests/minute, therefore 12–48 calls/minute | The action refetches the full task every five seconds only to update a wall-clock price |
| Task Drop containing N tasks | N–4N concurrent calls per render | The page fetches full detail for every task with `Promise.all` |
| DREAMS exchange-rate response | 3 calls | Rate, worker split and bonus are read independently |
| Deterministic rejected relay | Up to 6 simulations over about 30 seconds | Every simulation error enters the same fixed retry loop |
| Idle indexer without DREAMS | About 15 operations/minute/replica | One block-number read and two log reads every 12 seconds |
| Idle indexer with DREAMS | About 20 operations/minute/replica | One block-number read and three log reads every 12 seconds |
| Settlement hydration for N unique tasks | 2N contract reads, launched without a bound | Task and verdict state are fetched separately for every task |

The indexer figures assume the chain advances between polls, as Base normally does. A poll reads
the latest block once, then reads the main contract and identity logs, plus reward-hook logs when
configured. They describe network operations, not individual logs returned.

These paths multiply each other. A Drop with 25 DREAMS-enabled tasks can launch 100 contract calls
at once. One connected clock-auction viewer can cause 48 calls per minute even when no task state
changes. Adding an API replica adds another complete indexer poll stream. Invalid user actions can
occupy the provider for six attempts even when the first response already proves the call can
never succeed.

### There is no system-wide visibility or budget

Runtime chain access is spread across separately-created viem clients. The application cannot
currently answer, from one metric surface:

- which product operation caused a provider request;
- which JSON-RPC method was used;
- whether it was an original attempt, a coalesced request, or a retry;
- how many calls a page or mutation required;
- how much concurrency catch-up or fan-out created; or
- whether total usage grows with web viewers, task count, or backend replica count.

Without this accounting, optimizations can only be validated by reading control flow, and a later
feature can accidentally restore amplification without failing CI.

### Read semantics differ and should not share one cache policy

Task hook membership is committed at task creation and has no mutation path. It can be cached for
the lifetime of a process after a successful read. The DREAMS exchange rate, worker split and
bonus, by contrast, are owner-controlled mutable values. They must be read and exposed as one
coherent snapshot with an explicit age. Wallet balances and claimable rewards are more sensitive
still: they should only receive very short coalescing and must be invalidated after related writes.

Treating all three classes as uncached is wasteful. Treating all three as long-lived cached data
would silently weaken freshness and can produce incorrect user expectations.

### Existing correctness decisions constrain the solution

This proposal must preserve four accepted decisions:

- **ADR-0003:** migration, indexer catch-up and award reconciliation remain awaited startup gates.
  A backend must not serve while it is known to be behind or inconsistent.
- **ADR-0005:** a failed main-stream event continues to block checkpoint advancement and later
  main-stream events. Batching must fail closed rather than skip work.
- **ADR-0019:** the server wallet's nonce manager remains the shared nonce allocator. Retry changes
  must not consume speculative nonces or blindly rebroadcast ambiguous transactions.
- **ADR-0038:** public-read rate limiting must use the shared rate-limiting module and its distinct
  check shapes, not introduce route-specific counter logic.

## Proposal

### Operating principles and freshness budgets

Every RPC-backed value is assigned to one of the following classes. These are proposed defaults,
not hidden implementation details; changing a budget after acceptance requires an explicit
configuration or decision update.

| Data or operation | Proposed freshness/retry budget | Failure behavior |
| --- | --- | --- |
| Task hook membership | Process lifetime after a successful read | Cache positive and empty results; never cache transport or decode failure as empty |
| DREAMS settings snapshot | 30-second fresh TTL; last-known snapshot may serve informational reads for at most 5 minutes and must carry its observation time | No prior snapshot: retain today's absent-enrichment behavior; writes remain authoritative on-chain |
| Wallet balance and claimable reward | At most 2 seconds, used for identical-request coalescing rather than durable caching | A related successful mutation invalidates immediately; no stale-on-error response |
| Clock-auction display | Recalculate at least every 5 seconds from a server-anchored snapshot | Acceptance is always checked against current contract state; the displayed value is not authorization |
| Indexer steady polling | Existing 12-second interval; leadership failover within 24 seconds | Main-stream failure blocks checkpoint exactly as today |
| Pre-broadcast relay retries | Deterministic revert: 1 attempt. Allowlisted transient failure: at most 3 attempts within 10 seconds | Exhaustion returns the decoded/normalized error and consumes no write nonce |
| Post-broadcast receipt tracking | One transaction hash until terminal receipt or existing receipt timeout | Never submit a replacement merely because receipt polling failed |

The DREAMS snapshot comprises `dreamsPerUsdc`, `workerSplitBps` and `bonusBps` observed in one
multicall against one block. An API response must never combine fields from snapshots taken at
different blocks. Where response schemas permit an additive field, it should include the observed
block or timestamp so clients and operators can distinguish a fresh value from the bounded
last-known fallback. Contract execution remains the authority for any value locked or paid by an
on-chain action.

All cache and singleflight keys include chain ID and contract address. Task-hook keys additionally
include task ID; wallet keys include normalized wallet address and asset/read kind. Reconfiguration
therefore cannot make a value from one chain or deployment appear valid for another.

### Tier 0 — centralize and measure runtime RPC traffic

Create one runtime RPC client gateway for the API, relay and indexer. Public and wallet clients are
singletons per `(chain ID, RPC URL, account where applicable)` rather than reconstructed per helper.
Standalone deployment, smoke and maintenance scripts may create their own clients, but they are
outside production runtime accounting and must be visibly classified as such.

The gateway's transport records:

- chain ID and bounded attribution: the request procedure where one exists, otherwise a stable
  background or logical-operation name;
- JSON-RPC method;
- latency, outcome and normalized error class;
- original attempt versus retry;
- in-flight request count;
- an explicit cache/singleflight outcome, reported as `not_applicable` until a later tier introduces
  those layers; and
- for multicall, both the one network request and the number of logical subcalls.

Metric labels must never include wallet addresses, task IDs, transaction hashes, calldata, raw
errors, RPC URLs or credentials. Request-driven work uses a bounded procedure label such as
`tasks.get` or `wallet.balance`; background and nested work may supply a stable logical-operation
name such as `indexer`, `reconciliation`, `task_detail_hooks` or `relay_preflight`. Unknown runtime
RPC traffic uses an explicit `unattributed` label and is an alertable migration gap, not silently
omitted. Procedure names come from the registered router, never from request input.

Before behavior changes ship, record reproducible baselines for task detail, Task Drops with
1/10/50 tasks, a 60-second clock auction, wallet reads, successful and rejected relays, indexer
replica scaling, and settlement catch-up. The same workloads become counting-provider regression
tests. Absolute provider-spend or global percentage targets are set from those measurements, while
the per-journey budgets in this RFC can be enforced immediately.

### Tier 1 — remove application-driven amplification

#### Clock auctions

Return the parameters and server observation time required to calculate the current auction price.
The web client uses the same shared pure formula as the backend and updates its displayed price
locally. Resume from a hidden tab recalculates from elapsed time rather than replaying missed
ticks. Dutch and reverse-Dutch boundaries, expiry and rounding remain identical. The contract and
acceptance mutation continue to determine the authoritative accepted amount.

Result: a connected viewer causes no backend request or RPC call merely because time passed.

#### Task Drops and generated previews

Add chain-free, database-backed task projections for list/composition consumers. The Task Drop
projection contains lifecycle phase, entryability, visibility-safe counts and minimal ordered
winner information. The generated-preview projection contains only task ID, title source, public
reward and the visibility decision needed for fallback behavior. Existing task-detail schemas
remain compatible; both projections are additive and purpose-specific.

The Task Drop response is implemented with a constant number of database queries, then the web
page reads submissions/media only where they are actually needed for visible covers. It no longer
loads full task detail N times. Open Graph rendering uses its narrower chain-free projection. The
two projections share the same indexed-data and visibility-policy boundary, but do not share one
response schema because their privacy and composition needs differ.

Result: Task Drops and generated previews perform zero contract reads, independent of task count.

### Tier 2 — cache, coalesce and batch legitimate reads

#### Immutable task hooks

After a successful `getTaskHooks`, cache the exact array for the process lifetime. An empty array
is a valid successful result and is cached. A provider, timeout or decode error is not converted
into a durable empty result. Concurrent misses for one key collapse into one request.

This depends on the existing contract property that hooks are committed at task creation. If a
future contract upgrade adds a hook mutation path, that change must amend the eventual caching ADR
and add event-driven invalidation or remove process-lifetime caching before the upgrade is used.

#### Mutable DREAMS settings

Fetch all three settings as one multicall snapshot, then singleflight and cache that snapshot under
the budgets above. A `PriceUpdated` or `BonusBpsUpdated` indexer event invalidates the snapshot as a
latency improvement, but correctness does not depend on event delivery: the 30-second TTL is the
backstop. Because the current hook does not emit an event for `setWorkerSplitBps`, TTL expiry is
also required even when event invalidation is enabled.

Warm task-detail and exchange-rate reads perform zero DREAMS setting calls. A cold refresh costs
one network request rather than three. The same snapshot service is used everywhere so task detail,
wallet responses and creation estimates cannot implement divergent policies.

#### Wallet reads and public abuse control

Validate and normalize wallet addresses before any provider work. Collapse identical concurrent
reads and apply only the two-second budget above. A successful claim, withdrawal or transfer that
can affect a cached key invalidates it immediately.

All anonymous RPC-backed routes use ADR-0038's shared sliding-window capability. Roll out limits in
shadow mode first. The initial enforcement threshold for each route is the greater of 60 requests
per source per minute or five times the measured legitimate p99 one-minute rate, then is reviewed
against false-positive data before enforcement. A second global concurrency ceiling protects the
provider from distributed bursts; overflow fails fast with a stable `429` and `Retry-After` rather
than queueing unbounded work. Cache/singleflight hits do not consume the global provider-concurrency
slot, but still count toward per-source abuse policy so cached endpoints cannot become a free
application-layer flood target.

The source-key derivation must use the deployment's trusted-proxy configuration; untrusted
forwarded headers cannot choose a new identity. Addresses remain queryable for third parties — the
proposal protects the provider, not a new wallet-ownership authorization requirement.

#### Settlement and catch-up batching

Read task and verdict settlement state in bounded multicall batches. Bound block-timestamp fetches
and historical reconciliation to an initial maximum of four in-flight provider requests per
process. A failed required subcall fails the batch and leaves the checkpoint unchanged; it must not
silently fan out into unbounded individual retries. Retrying the unchanged range remains
idempotent under ADR-0005.

### Tier 3 — make relay RPC work predictable

Replace the single catch-all retry loop with an explicit classifier:

- A decoded contract revert, including an unknown/custom revert returned by a successful RPC
  response, is deterministic for the attempted state and is surfaced after one preflight.
- Provider timeout, connection reset, explicit throttling and documented read-after-write
  state-lag signatures are transient before broadcast and may use the bounded three-attempt budget.
- Invalid input, encoding errors, configuration errors and insufficient funds are deterministic
  and are never retried.
- An unclassified error defaults to no automatic retry until production evidence supports adding a
  narrow class. Classification begins in observe-only mode so current errors can be compared.

Use one gas-estimation/preflight result for the write rather than simulating and then triggering an
implicit second estimate. The relay primitive returns its receipt metadata. Callers do not wait for
the same receipt a second time merely to recover a block number.

Once a write returns a transaction hash, the operation leaves the pre-broadcast retry state and
tracks that hash to a terminal receipt or the existing timeout. It is never resubmitted with a new
receipt nonce solely because receipt polling failed. If the provider returns an ambiguous send
error without a transaction hash, the backend does not blindly rebroadcast; it reconciles the
server account nonce and known transaction state first. These rules preserve ADR-0019's nonce
manager and prevent an RPC optimization from creating duplicate effects or nonce gaps.

Fee quotes may be singleflighted for one block. A confirmed unlimited forwarder allowance may be
remembered in process memory, but only after its approval receipt succeeds; allowance-related
errors, process restart and configuration changes force an authoritative reread. This allowance
optimization is lower priority and ships separately from retry correctness.

### Tier 4 — one steady-state indexer owner

Every backend replica continues to run and await its own startup sequence:

`migrate → catchUpIndexer → reconcileTaskAwards → listen`

This RFC does not weaken ADR-0003. Startup failures remain fatal and there is no stale-serving
fallback.

After startup succeeds, replicas contend for a PostgreSQL-backed leadership lease scoped by chain
ID and environment. Only the lease holder runs the periodic poll. Followers attempt acquisition at
the existing 12-second interval and do not perform steady-state log reads while they are followers.
The lease must be connection-bound or time-bounded so ownership transfers within 24 seconds after a
leader exits or loses its database connection. A process-local serialized-poll guard remains in
place, so one leader cannot overlap its own polls.

Leadership changes ownership, not event semantics. The shared database checkpoints remain the
source of the next range. A main-stream processing failure still prevents checkpoint advancement
and blocks later events under ADR-0005. Identity and reward-hook streams retain their existing
per-event handling unless separately reconsidered. Two or more replicas must produce one
steady-state poll stream for the environment, while a compatibility switch can temporarily restore
per-process polling during rollout.

The exact PostgreSQL primitive — session advisory lock or explicit renewable lease row — remains an
open question and requires its own ADR when decided. The required properties are single active
owner, bounded failover, observable ownership, no checkpoint regression and no weakening of startup
catch-up.

### Tier 5 — provider configuration, budgets and rollout

Production must use a dedicated RPC endpoint rather than the rate-limited public Base endpoint
shown in `.env.example`. Configuration validation should first warn, then fail production startup
for known public hosts after every environment has a dedicated endpoint. A temporary, explicit
operator override provides rollback; local Anvil, tests and previews remain supported. Logs and
metrics redact the full URL and credentials.

CI counting-provider tests enforce at least these budgets:

- clock-auction ticking: zero backend chain work;
- Task Drop and generated-preview composition: zero chain work;
- repeated warm task detail: zero chain work;
- cold DREAMS snapshot: one network request;
- deterministic relay rejection: one preflight and no consumed write nonce;
- steady indexer load: constant as API replicas increase; and
- settlement catch-up: within configured batch and concurrency limits.

Roll out in the following order:

1. Metrics and singleton clients, with no behavior change.
2. Capture and approve the production-shaped baselines in issue #393.
3. Clock-auction, Task Drop and generated-preview amplification removal.
4. Immutable-hook and DREAMS-snapshot caching.
5. Public-read shadow limits, followed by reviewed enforcement.
6. Relay classification in observe-only mode, then enforcement and receipt deduplication.
7. Settlement batching and bounded catch-up.
8. Steady-state indexer leadership last.
9. Remove compatibility switches only after a stable soak.

Abort or roll back a tier if an API result differs from the control path, an indexed checkpoint
advances after required processing fails, indexer lag exceeds two poll intervals, transaction
errors or nonce reconciliation increase, public-read false positives exceed the agreed threshold,
or provider error rate materially rises. Product polling that is database-only is not part of the
RPC reduction target and keeps its current cadence.

Each implemented mechanism from this RFC requires an approved ADR, per the repository RFC process.
At minimum, separate ADRs should cover cache/freshness semantics, relay retry semantics and
steady-state indexer leadership; the latter should state explicitly how it preserves ADR-0003 and
ADR-0005.

The first implementation frontier reserves ADR-0039 through ADR-0043 for the gateway, provider
guard, Task Drop projection, local clock-auction ticking and generated-preview projection
respectively. Those records remain `Proposed` on their implementation PRs until a human Decider
accepts them. Draft implementation may be reviewed and tested in parallel, but none of those PRs
is merge-ready before its ADR is accepted; Tier 1 PRs additionally wait for the issue #393 baseline.
Because each concurrent ADR branch regenerates the same structured index, every implementation PR
must merge or rebase the latest `main` and regenerate the ADR index after any sibling ADR lands.

## Alternatives considered

### Reduce all polling intervals

Rejected as a general strategy. It trades functionality and freshness for fewer requests without
addressing why a clock tick loads full task detail or why every replica owns the same indexer work.
Database-only live views are not material RPC consumers and should not be slowed.

### Cache every contract read under one TTL

Rejected. Immutable hooks, mutable settings and wallet balances have different correctness and
freshness requirements. One TTL is either wasteful for hooks or too stale for balances.

### Persist all chain configuration in the database and never read it on demand

Rejected for this proposal. The indexer intentionally has different failure behavior across its
streams, and the reward-hook audit stream is not currently an authoritative materialized state
store. A bounded on-chain snapshot is simpler and remains correct even after a missed non-blocking
hook event.

### Run a separate dedicated indexer service immediately

Deferred. It gives clean ownership but creates a new deployable, health surface and operational
dependency. Database-backed leadership within the existing backend achieves constant steady-state
load with a smaller first commitment. A dedicated service remains a future option if indexer
throughput or ownership complexity grows.

### Retry every relay error with exponential backoff

Rejected. Backoff changes timing, not determinism. It continues to spend provider capacity on
contract reverts and makes invalid actions slow, while ambiguous post-broadcast retries can
conflict with ADR-0019's nonce safety.

### Use only provider-side rate limits

Rejected. Provider throttling lacks product-operation context, cannot coalesce identical work, and
turns application overload into slow or inconsistent user failures. It remains a final safety net,
not the application's operating policy.

## Open questions

1. Is 30 seconds fresh and 5 minutes maximum stale-on-error the right DREAMS informational budget,
   or should the endpoint refuse stale data instead of serving a clearly marked prior snapshot?
2. Should a future `WorkerSplitBpsUpdated` hook event be added so every mutable snapshot field can
   invalidate promptly, or is the 30-second TTL sufficient? Adding an event is a contract change
   and is not required by this RFC.
3. Should snapshot age be added to public response schemas immediately, or initially remain an
   internal metric while the API stays byte-for-byte compatible?
4. What measured false-positive rate is acceptable before public-read limits move from shadow to
   enforcement, and should trusted internal clients receive a separately authenticated budget?
5. Should the global public-read protection be a concurrency semaphore only, or also include a
   distributed request-rate budget across replicas?
6. For indexer leadership, should Taskmarket use a session-bound PostgreSQL advisory lock or an
   explicit renewable lease row? The latter exposes ownership and expiry directly but introduces
   more state and clock/renewal logic.
7. Should startup catch-up eventually coordinate across concurrently starting replicas while each
   replica still independently verifies caught-up state, or is startup amplification acceptable
   because ADR-0003's gate is infrequent and correctness-sensitive?
8. Which exact provider error signatures have demonstrated read-after-write lag and should enter
   the transient relay allowlist? Until evidence exists, unclassified errors remain non-retryable.
9. Does production require provider failover in this RFC, or should the first version require one
   dedicated provider and leave cross-provider consistency, retry and health policy to a later RFC?
10. What soak duration and request/error thresholds are required before each compatibility switch
    is removed?

## Non-goals

- Removing or slowing user-visible functionality, including clock-auction updates, live activity,
  wallet reads, DREAMS estimates or indexer freshness.
- Changing task, award, payment, visibility, reward-hook or X402 business semantics.
- Weakening ADR-0003 startup fail-fast behavior or ADR-0005 main-stream checkpoint blocking.
- Replacing ADR-0019's nonce manager or automatically rebroadcasting an ambiguous transaction.
- Making indexed DREAMS events the sole authority for current reward settings.
- Adding a new contract hook-mutation function or a `WorkerSplitBpsUpdated` event as part of this
  proposal.
- Building a general CDN, response cache or distributed cache platform.
- Rate-limiting database-only endpoints merely because they poll frequently.
- Treating scripts, deployment tools and smoke-test clients as production runtime traffic, though
  their direct client creation may be standardized separately.
- Selecting a long-term RPC vendor, pricing plan or multi-provider failover strategy.
- Claiming a global percentage or cost reduction before runtime instrumentation establishes the
  production baseline.

## References

- Tracking epic: #391
- Related ADRs: ADR-0003 (startup catch-up and reconciliation fail fast), ADR-0005 (main-stream
  event failures block checkpoint advancement), ADR-0019 (server-wallet nonce manager), ADR-0038
  (shared rate-limiting module)
- RFC process: ADR-0032 and `docs/rfc/README.md`
- Backend task reads: `apps/backend/src/routers/tasks.router.ts`,
  `apps/backend/src/services/contract.ts`
- Web amplification paths: `apps/web/components/market/actions/auction-accept-button.tsx`,
  `apps/web/components/market/task-drops/drop-page/drop-data.ts`
- Public wallet reads: `apps/backend/src/routers/wallet.router.ts`
- Indexer startup and polling: `apps/backend/src/server.ts`,
  `apps/backend/src/services/startup-preparation.ts`, `apps/backend/src/services/indexer.ts`
- Hook immutability and DREAMS mutable settings: `packages/contracts/src/facets/RegistryFacet.sol`,
  `packages/contracts/src/hooks/TaskTokenRewardHook.sol`
- Production example configuration: `.env.example`
- First-frontier implementation PRs: #409 (provider guard), #410 (RPC gateway), #411 (Task Drop
  projection), #412 (clock-auction ticking), #413 (generated-preview projection)
