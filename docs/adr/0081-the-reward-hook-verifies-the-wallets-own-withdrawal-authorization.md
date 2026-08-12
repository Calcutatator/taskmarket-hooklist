# 0081 — The reward hook verifies the wallet's own withdrawal authorization

> **Decision (Y-statement):** In the context of `withdrawFor` on the DREAMS reward hook, whose only
> check was that the caller is the backend, facing a claimable ledger whose entire safety rested on
> one off-chain hot key remaining correct in every present and future code path, we decided to
> verify the wallet's own signature over (destination, nonce, validBefore) inside the contract and
> to record spent nonces on-chain, reusing the byte-identical EIP-191 message clients already
> produce, to achieve an on-chain binding between a wallet and where its balance may go, accepting
> the gas cost of reconstructing that message in Solidity, and putting the hook behind a proxy so
> that shipping this and any later fix no longer costs a full redeployment.

- **Status:** Accepted
- **Date:** 2026-08-11
- **Accepted:** 2026-08-12
- **Embodiment:** Not started
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Realized by:** packages/contracts/src/hooks/TaskTokenRewardHook.sol@907bd33be62fd3fbfc50808e5781de56bc0e2f7f
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

`withdrawFor(wallet, destination)` transferred a wallet's entire claimable DREAMS balance to an
arbitrary destination, gated only by `msg.sender == backend`. The contract never checked that
`destination` had anything to do with `wallet`.

**This was not exploitable.** The one caller, `wallet.router.ts`, already required an EIP-191
signature from the wallet binding destination, nonce and expiry, and refused the call without it.
The gap was that this binding existed only there. The claimable ledger for every user was as safe
as one hot key being correct — not just today, but in every future code path that might call
`withdrawFor` without remembering to replicate the check. That is a property no reviewer can
verify by reading the contract, which is where the property should live.

Replay protection had the same shape: the backend tracked spent nonces in its own database, so a
captured authorization was un-replayable only for as long as that database and that key stayed
correct.

The relayer relationship is what makes this subtle. The backend relays and pays gas, so
`msg.sender` is never the wallet and cannot authorize anything on the wallet's behalf. An
authenticated caller is not an authorized one, and the contract had no way to tell the difference.

## Considered options

| Option                                                                          | Pros                                                                                                                                                                                                                                    | Cons                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Verify the existing EIP-191 message on-chain** (chosen)                        | The contract enforces the binding the backend already enforces, so a compromised or forgetful caller cannot redirect a balance. Every wallet, CLI and web client keeps signing exactly what it signs today — no client migration at all | Reconstructing the message string in Solidity (address to lowercase hex, uint to decimal) costs gas and is more code than hashing typed data                                              |
| Switch to EIP-712 typed data (rejected)                                          | Cheaper and cleaner on-chain; typed data is the modern convention and is what the original finding suggested                                                                                                                             | Changes what every client signs. The CLI, the web app and any agent that has automated withdrawal would all need to migrate together, and a half-migrated fleet fails at the signature check |
| Leave it, and rely on the off-chain check (rejected)                             | No contract change, no redeploy, no gas                                                                                                                                                                                                 | Leaves the whole ledger resting on one key with no on-chain backstop, and leaves the rule unenforceable against future callers. Defence in depth is the entire point of the finding        |
| Restrict `destination` to the wallet itself (rejected)                           | Simplest possible binding, no signature needed                                                                                                                                                                                          | Removes a real capability — withdrawing to a separate address is deliberate, and users rely on it                                                                                         |

## Decision

1. `withdrawFor` takes `(wallet, destination, nonce, validBefore, signature)` and recovers the
   signer from the EIP-191 message
   `taskmarket:withdraw-dreams:<destination>:<nonce>:<validBefore>`. It reverts unless the signer
   is `wallet`.
2. The message is byte-identical to the one clients already produce. No client changes.
3. `usedWithdrawNonce`, keyed on `keccak256(wallet, nonce)`, makes replay protection on-chain
   rather than solely a property of the backend's database.
4. `validBefore` is enforced on-chain, so an expired authorization cannot be relayed late.
5. `msg.sender == backend` stays. The two checks are complementary: the backend still pays gas and
   still gates who may relay, and the wallet now says where its own money goes.

## Consequences

**Positive:**

- A compromised backend key can no longer redirect any wallet's balance. It can refuse to relay,
  which is a denial of service rather than a theft.
- The rule is enforced where a reader can see it, so a future caller cannot forget to apply it.
- Replay protection no longer depends on one database staying correct.

**Negative / trade-offs:**

- Shipping it requires a hook redeployment (`make swap-reward-hook`), which per ADR-0028 requires
  zero outstanding reservations in the RewardVault. That is an operational window, not a
  code change, and it is the real cost of this decision.
- String reconstruction costs gas on every withdrawal. Acceptable for an operation that already
  moves tokens, and the price of not migrating every client.
- An intent recorded before this change cannot be broadcast afterwards: its payload never captured
  a signature. Those intents fail loudly rather than being relayed unauthorized.

**Neutral / follow-up:**

- The three new errors are named automatically by the derived error map (ADR-0080's neighbour,
  #521), so nothing has to be hand-registered for them to decode.
- If EIP-712 is ever wanted, it can be added as a second accepted format alongside this one
  rather than as a replacement, which would let clients migrate independently.

## References

- [ADR-0028 — a reward hook upgrade leaves the old hook authorized until drained](0028-reward-hook-upgrade-leaves-old-hook-authorized-until-drained.md)
- `packages/contracts/src/hooks/TaskTokenRewardHook.sol` — `withdrawFor`, `usedWithdrawNonce`.
- `apps/backend/src/routers/wallet.router.ts` — the off-chain check this now mirrors on-chain.
- Issue #327 — the finding.
