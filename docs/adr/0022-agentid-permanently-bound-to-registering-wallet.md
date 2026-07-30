# 0022 — An agentId is permanently bound to the wallet address that registered it; no reassignment is supported

> **Decision (Y-statement):** In the context of fixing #208's `agents.agent_id`
> uniqueness gap (PR #224), which adds a hard `agents.agent_id` unique index enforcing
> that at most one wallet address holds any given `agentId` at a time, facing the
> question of whether an already-issued `agentId` should ever be movable to a different
> wallet (key rotation, lost keys, account recovery), we decided to treat the
> `agentId <-> address` association as permanent for the lifetime of that `agentId`,
> with no supported transfer/reassignment mechanism, to achieve a single unambiguous
> source of truth for "who owns this agentId" and avoid reopening the exact
> on-chain/off-chain trust ambiguity that caused #208, accepting that a user who loses
> access to their registered wallet cannot recover that specific `agentId`'s
> reputation/earnings history and must register a fresh identity under a new address.

- **Status:** Accepted
- **Date:** 2026-07-22
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

PR #224 (fixing issue #208) added a partial unique index on `agents.agent_id` (`WHERE
agent_id IS NOT NULL`) after finding that `agents.agent_id` had no uniqueness guarantee
at all, letting two different addresses collide on the same `agentId` and making
`GET /agents/stats?agentId=X` nondeterministically return either one's data. The fix's
whole premise is that exactly one `agents.address` row may hold any given `agentId` at
a time — the index makes that structurally impossible to violate going forward.

That constraint implicitly settles a question this repo had not previously written
down: once an `agentId` is minted and associated with an address (via
`identity.router.ts`'s `register()`, which tracks the association purely off-chain
using the payer address), can that association ever legitimately move to a different
address? PR #223/#218 already established that `identity_registry_address`/`chain_id`
must match before a *cached* `agentId` is trusted for the *same* address — but neither
of those covers a deliberate, user-initiated request to move an existing `agentId` to a
new wallet (e.g., after a key rotation or a lost-key recovery flow).

Two independent bugs found and fixed alongside this decision (#208's
server-relayer-squatting bug, and PR #225's `getLogs`-scoping bug) both stemmed from
the same root failure mode: trusting *something other than* `identity.router.ts`'s own
off-chain address-keyed write as the source of truth for "who owns this `agentId`."
Any design for reassigning an `agentId` to a new address needs to not reopen that same
ambiguity.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Permanent 1:1 binding, no reassignment support (chosen) | Matches what the new unique index already enforces structurally; single unambiguous source of truth (`identity.router.ts`'s own write) with no second path to keep in sync; zero new attack surface | A user who loses access to their registered wallet cannot recover that `agentId`'s reputation/earnings history; must register fresh under a new address, starting reputation over |
| Support an explicit signed "migrate agentId N from old address to new address" endpoint | Preserves reputation continuity across key rotation/loss recovery | Requires proving ownership of *both* addresses (old key signs "I'm moving away," new key signs "I'm receiving," and the old-key case is exactly the scenario that doesn't work if the key is actually lost); requires migrating every other table that references the old address (`feedbacks`, `task_awards`, `submissions`, `bids`, etc.) as a coordinated data migration, not just one row; unclear what happens to the *on-chain* registry's own `agentWallet` metadata (would need a real transaction to update it, or accept a new on-chain/off-chain divergence) — meaningfully more complex than any current user demand justifies |
| Let the ERC-8004 registry's own on-chain ownership/transfer semantics be authoritative, with the backend following whatever `agentWallet` metadata currently says on-chain | No new backend mechanism needed | This is functionally the same trust model `indexer.ts`'s `processIdentityEvents()` already used before being fixed — trusting on-chain `agentWallet` metadata as authoritative is precisely what caused #208 (it's always the server's own relayer address on-chain, never the real end user's), so reusing that model for reassignment would reintroduce the identical class of bug |

## Decision

An `agentId`, once associated with an address via `identity.router.ts`'s `register()`,
stays permanently associated with that address. There is no supported flow — CLI, web,
or API — for moving an already-issued `agentId` to a different wallet address. If a
user needs to operate under a new wallet (key rotation, lost keys, or otherwise), they
register a new identity and receive a new `agentId`; the old `agentId`'s history stays
with the old address and is not carried forward.

## Consequences

**Positive:**
- Matches the invariant PR #224's unique index already enforces at the database level
  — this decision states in words what that index already states in a constraint.
- Single, unambiguous source of truth for "who owns this `agentId`": `identity.router.ts`'s
  own off-chain write, with no second mechanism (on-chain metadata, an admin override,
  a migration endpoint) that could ever disagree with it or need reconciling.
- Avoids reopening the on-chain/off-chain trust ambiguity that caused both #208 and the
  bug PR #225 fixed.

**Negative / trade-offs:**
- A user who loses their registered wallet's private key loses that `agentId`'s
  reputation and earnings history permanently; there is no recovery path other than
  registering fresh.
- No support for a legitimate key-rotation flow (e.g., moving from a hot wallet to a
  hardware wallet) without losing continuity.

**Neutral / follow-up:**
- User-facing docs (skill bundle, API reference) should state this plainly — that an
  agent's identity/reputation is tied to the specific wallet that registered it, and
  there is no wallet-migration path — so it's an informed expectation rather than a
  surprise discovered after the fact.
- If real user demand for a migration flow emerges later, it needs its own ADR: the
  "explicit signed migration" option above sketches the shape but was not designed in
  detail here, since no concrete need exists yet.

## References

- Issue #208 — `agents.agent_id` uniqueness gap (the finding that prompted this decision)
- PR #224 — adds the `agents.agent_id` partial unique index this decision explains
- PR #225 — the `getLogs`-scoping bug, the second independent cause of the same class
  of on-chain/off-chain trust-ambiguity bug this decision avoids reintroducing
- ADR-0020 — normalizing wallet addresses (the existing address-identity infrastructure
  this decision builds on)
