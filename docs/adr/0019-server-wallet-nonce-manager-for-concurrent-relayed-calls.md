# 0019 — Server wallet uses a nonce manager to serialize concurrent relayed calls

> **Decision (Y-statement):** In the context of `createServerWallet()`
> (`apps/backend/src/lib/wallet.ts`), the one account that signs every on-chain call the
> backend relays on a caller's behalf (task creation, identity registration, accept/rate/
> cancel, evaluator actions, and more), facing concurrent requests each independently reading
> that account's pending transaction nonce before submitting, we decided to attach viem's
> `nonceManager` (`viem/nonce`) to the account so nonce allocation is serialized per
> `(address, chainId)` across every `createServerWallet()` call in the process, to achieve
> reliable concurrent on-chain submission from a single relayer account, accepting that this
> does not fix the separate bug where a relayed call's eventual failure can still be silently
> swallowed by a caller that doesn't await or handle it.

- **Status:** Proposed
- **Date:** 2026-07-21
- **Deciders:** (pending human approval)
- **Supersedes / Superseded-by:** —

## Context

Every on-chain action the backend performs on a user's behalf — creating a task's escrow,
minting an ERC-8004 identity, accepting/rating/cancelling a task, evaluator verdicts, and so
on — is signed and submitted by one shared account: the server wallet returned by
`createServerWallet()`. That function builds a fresh `viem` `WalletClient` per call, but the
underlying `Account` was constructed with `privateKeyToAccount(key)` and no nonce manager. By
default, `viem` resolves the nonce for a transaction by reading the account's current pending
transaction count from the chain at submission time.

This is fine for a single in-flight call, but not for two: if two calls signing with this same
account are in flight at once, both can read the same "current" nonce before either has
actually landed on-chain, and both then submit with that same nonce. Only one can be accepted;
the other fails with `Nonce provided for the transaction is lower than the current nonce of
the account`.

This was found while running the smoke suite for a deep review of PR #110 (task visibility) —
unrelated to that PR's actual scope, but a real bug surfaced by exercising concurrent device
registrations (`apps/backend/src/routers/devices.router.ts`'s `register` mutation calls
`contractRegisterIdentity()` in the background via a bare `.then()/.catch()`, not awaited by
the request). Reproduced directly: five concurrent device registrations, four of five failed
with the nonce error every time, and because the background call's failure path is a bare
`.catch(err) => console.error(...)`, the caller's device is left with `agents.agentId` stuck
`null` forever — no user-facing error, no retry, no visible signal anything went wrong short of
reading backend logs.

An earlier, separate-looking symptom noticed during the same review — three different wallet
addresses all recorded with the same `agentId` in the `agents` table — turned out on
inspection (direct on-chain log reads showing agent IDs 0 through 15 assigned once each, with
no on-chain duplicates) to be stale rows left over from a mid-session chain reset, not a
second live bug. The concretely reproducible, currently-live bug is the nonce race described
above.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Attach viem's `nonceManager` to the account in `createServerWallet()` (chosen) | Minimal, localized change (one function); fixes every current and future concurrent caller of `createServerWallet()` at once, not just identity registration, since they all share this one helper; viem's manager reads the chain once per `(address, chainId)` and serves subsequent concurrent requests an incremented value locally rather than re-querying and racing | Relies on the in-process manager's local nonce cache staying consistent with chain state; if a transaction it allocated a nonce for reverts or never lands, recovery still depends on viem's own reconciliation (falls back to re-querying the chain), not something this change adds bespoke handling for |
| Serialize all `createServerWallet()`-signed calls behind a single mutex/queue for the whole process | Same end result (no two submissions race on a nonce); conceptually simpler to explain | Coarser than necessary — serializes the entire submit-and-wait-for-receipt round trip for every relayed call process-wide (task creation blocks behind an unrelated identity registration, etc.), not just the nonce-allocation instant; throughput cost scales with total relayed-call volume rather than just the moment of nonce assignment |
| Leave as-is; treat as low-priority since production traffic may rarely hit true concurrency | No work required | Already concretely reproduced, not hypothetical; the failure mode is silent (a swallowed background `.catch()`), so it degrades UX with no operator visibility until a user notices their agentId never appeared — the kind of bug that's cheap to miss until it's a support ticket |

## Decision

`createServerWallet()` (`apps/backend/src/lib/wallet.ts`) now passes viem's `nonceManager`
(imported from `viem/nonce`) to `privateKeyToAccount(key, { nonceManager })`. Because the
manager is a module-level singleton keyed internally by `(address, chainId)`, this correctly
serializes nonce allocation across every `createServerWallet()` invocation in the process —
not just within one call — with no other code path changes required.

## Consequences

**Positive:**
- Concurrent calls into any `createServerWallet()` consumer (task creation, identity
  registration, accept/rate/cancel, evaluator actions, refund-expired, etc.) no longer race on
  the relayer account's nonce. Verified directly: five concurrent device registrations, which
  reliably failed four-of-five before this change, now each land on a distinct, correct
  agentId with the fix in place.
- The fix lives in one shared helper, so it protects every current and future relayed on-chain
  call without needing to be re-applied per router.

**Negative / trade-offs:**
- Does not fix the separate bug that made the nonce race's failure mode silent:
  `devices.router.ts`'s background `contractRegisterIdentity()` call is fire-and-forget, and
  its `.catch()` only logs to the console — a caller whose relayed call fails for *any* reason
  (not just a nonce race; the underlying issue class is broader) still gets no error and no
  retry, just a permanently-null `agentId`. That is a legitimate follow-up, not addressed here.
- Relies on viem's nonce manager behaving correctly under chain reorgs or dropped transactions;
  this ADR does not add bespoke reconciliation beyond what viem provides.

**Neutral / follow-up:**
- Whether `devices.router.ts`'s background registration should get a visible retry or
  dead-letter mechanism (so a permanently-`null` `agentId` is detectable and recoverable
  without reading backend logs) is a separate, follow-up decision, not part of this one.
- Regression coverage: `apps/backend/scripts/smoke-identity.ts` step 6 fires five concurrent
  device registrations and asserts every one lands on a distinct, non-null `agentId`.
  `apps/backend/scripts/smoke-concurrent-tasks.ts` covers a second, unrelated call site
  (`contractFinalizeVerdict`, reached via the permissionless finalize-verdict endpoint) to
  confirm the fix generalizes beyond identity registration to any `createServerWallet()`
  consumer.

## References

- `apps/backend/src/lib/wallet.ts` — `createServerWallet()`, the change itself
- `apps/backend/src/routers/devices.router.ts` — the background `contractRegisterIdentity()`
  call whose silent-failure follow-up is noted above
- `apps/backend/scripts/smoke-identity.ts` — regression coverage for the concurrent-
  registration race
- `apps/backend/scripts/smoke-concurrent-tasks.ts` — regression coverage for a second call
  site (`contractFinalizeVerdict`)
- PR #110 deep-review smoke-test pass (this bug was found incidentally, unrelated to that
  PR's task-visibility scope)
