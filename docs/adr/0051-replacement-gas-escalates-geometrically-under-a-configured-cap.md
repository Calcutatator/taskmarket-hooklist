# 0051 — Replacement gas escalates geometrically under a configured, per-deployment cap

> **Decision (Y-statement):** In the context of gas being the only mutable field of a relayed
> write, facing a reconciler that replaces every stuck transaction at one flat 2x multiplier
> compiled into the backend, we decided that each replacement attempt escalates geometrically from
> the fee that attempt is replacing, floored by the live fee oracle and clamped by a cap expressed
> as a multiple of the original fee, with the curve, the cap and the floor configured through
> validated environment variables whose defaults are chosen for Base, to achieve replacements that
> actually get more competitive each time without a fee spike draining the server wallet, accepting
> a small configuration surface and a deliberate bias towards overpaying for gas rather than letting
> the relayer stall.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

ADR-0040 gave the server wallet a durable nonce allocator, an outbox, and a background reconciler
that replaces a nonce which has sat unmined past a stuck threshold. ADR-0050 fixed what a
replacement or a rebroadcast is allowed to change: **the nonce, the calldata, `validBefore`, the
receipt nonce and the user-signed x402 authorisation are all immutable; only `maxFeePerGas` and
`maxPriorityFeePerGas` move.** That is exactly a wallet's "speed up", and it leaves gas as the
single configurable surface of the whole retry mechanism. ADR-0050 named the escalation policy as a
follow-up needing its own decision and specified no curve and no number. This is that decision.

Today `apps/backend/src/lib/wallet.ts` holds one constant:

```ts
const REPLACEMENT_GAS_MULTIPLIER = 2n;
```

and `sendReplacement` reads `estimateFeesPerGas()` fresh on every call and multiplies it by that
constant. Two problems follow, and the first is worse than "the curve is not steep enough".

### There is no progression, and the second attempt can be rejected outright

The multiplier is applied to the *current oracle reading*, not to the fee of the transaction being
replaced. So if 2x the oracle was not enough to get mined, the replacement sits, hits the stuck
threshold, and is replaced again at 2x the oracle. If the oracle has not moved in the intervening
90 seconds, the second replacement is priced identically to the first.

That is not merely "no more likely to land". Nodes enforce a minimum replacement price bump — around
10% on the mempool implementations we relay through — so a replacement priced at or near its
predecessor is not a weak attempt, it is **rejected before it enters the mempool at all**. The
reconciler logs "replacement transaction failed", leaves the row exactly where it was, and tries
again on the next pass with the same number. The loop can run indefinitely without ever putting a
new transaction on the network, which is the failure mode ADR-0040's reconciler exists to prevent,
reappearing one level up.

When the oracle *has* risen, the current code accidentally does the right thing, which is why this
has not been visibly broken. That is luck, not design.

### The constant cannot be right for more than one chain

Base and Ethereum mainnet have very different fee dynamics: Base's base fee is small and moves in
small absolute steps, so a large multiple of it is cheap and a doubling is a reasonable opening bid;
Ethereum mainnet's base fee is large, and the same multiple is a materially expensive transaction
that may still be outbid during a real spike. A single number compiled into the backend serves at
most one of them. This repo deploys per chain (`CHAIN_ID` is itself an environment variable), so the
policy belongs in configuration alongside it, following the pattern in
`apps/backend/src/config/env.ts` rather than a new one.

### The cost asymmetry that shapes the whole decision

The reconciler's replacement is a zero-value self-transfer: 21,000 gas. At Base fee levels, even a
wildly overpriced one costs a fraction of a cent. What it buys is the release of a nonce that is
blocking *every* higher nonce belonging to the shared server wallet — which is to say, every paid
write on the platform. Incident #54 was precisely this: one stuck nonce, every subsequent relayer
transaction pending behind it, until a human restarted the process.

So the two directions of error are not symmetric. Too timid means intents stall platform-wide and
paying users see nothing happen. Too aggressive means the server wallet burns some ETH on 21,000-gas
transactions. **We would rather burn the ETH**, and the cap exists so that "rather burn the ETH" has
a floor under it rather than being an open-ended bet against a fee spike.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Geometric escalation from the fee being replaced, floored by the live oracle, clamped by a cap expressed as a multiple of the original fee, all configured per deployment (selected) | Every attempt clears the provider's minimum bump by construction, because the base of the multiplication is the price that failed, not a reading that may not have moved; escalation is genuinely monotonic, so attempt *n* is strictly more competitive than attempt *n-1*; the oracle floor means a chain-wide fee jump is picked up immediately rather than being approached one multiplication at a time; the cap bounds the worst case at a number an operator can reason about in advance; Base and Ethereum get different numbers without different code | A curve plus a cap plus a floor is three knobs where there was one constant; the previous attempt's fee must be read back from the outbox row, which the current `sendReplacement(nonce)` signature does not carry; a badly configured cap below the first bump would silently flatten the curve, so it needs a validation check — and because the cap and the bid are multiples of different quantities, that check can only be made per transaction, not at boot |
| Flat multiplier applied to the live oracle (status quo, rejected) | One constant, no state to read back, no configuration surface; works whenever the oracle is rising, which during genuine congestion it usually is | Produces an identical price on a flat oracle, which providers reject as an insufficient bump, so the "retry" can consist entirely of rejected sends; no attempt is more likely to land than the last; cannot be right for two chains at once; the one case where it fails hardest — a transaction stuck for a reason other than a rising market, e.g. a propagation problem — is exactly the case a replacement is for |
| Additive escalation: add a fixed absolute premium (in gwei) per attempt (rejected) | Trivially monotonic; the absolute cost of each step is knowable in advance; no multiplication overflow concerns | An absolute premium is chain-specific in the hardest way — a step meaningful on Base is a rounding error on Ethereum mainnet during a spike, and one large enough for mainnet is absurd on Base; on a low base fee, a fixed addend can also be a far larger *proportional* jump than intended. Percentages travel across chains and fee regimes; absolute gwei amounts do not, so this pushes more configuration burden onto the operator, not less |
| Track the network fee oracle per attempt, with no escalation of our own (rejected) | Always priced at what the network currently says is sufficient; never overpays relative to the market; nothing to tune | This is the status quo minus its multiplier, and it fails for the same reason: on a flat oracle the resubmission is priced at or below its predecessor and gets rejected for an insufficient bump. It also assumes the oracle is why we are stuck, and a transaction can be stuck for reasons the oracle knows nothing about. The oracle is the right *floor* — it catches a market that moved faster than our curve — but it cannot be the whole policy, so this option is folded into the selected one rather than standing alone |
| Do nothing: rely on `validBefore` to end retrying, and replace only at the flat rate (rejected) | Zero work; the deadline already bounds the intent, so a badly-priced replacement cannot loop forever | Confuses two different jobs. The deadline bounds how long we keep trying to deliver *the payer's intent*; it says nothing about clearing *the nonce*, which must be cleared whether or not any intent still cares, because it blocks the shared wallet. A stuck nonce outliving its intent's deadline is still a platform-wide outage, so "the deadline handles it" is only true for the half of the problem the payer can see |
| Per-chain lookup table compiled into the backend, keyed by `CHAIN_ID` (rejected) | No environment variables; correct defaults per chain live in one reviewed place; impossible to misconfigure at deploy time | Changing a number during an incident requires a code change and a deploy, which is the opposite of what an incident needs; a preview environment or a fork chain gets whatever the table says about an id it does not really share behaviour with; and it does not remove the need for validation, it just moves the wrong values from a rejected boot to a merged commit. Sensible per-chain *defaults* are worth having, and the selected option keeps them — as defaults over an override, not instead of one |

## Decision

### 1. Escalation is geometric, and its base is the fee it is replacing

For a nonce being replaced for the *n*-th time, the replacement fee is:

```
ceilDiv(a, b)   = (a + b - 1n) / b

attempt 1:  fee = ceilDiv( oracle x FIRST_BUMP_PCT, 100n )
attempt n:  fee = max( ceilDiv( previous_attempt_fee x ESCALATION_PCT, 100n ),
                       ceilDiv( oracle x FIRST_BUMP_PCT, 100n ),
                       previous_attempt_fee + 1n )
            then clamped to  original_fee x MAX_MULTIPLE
```

applied independently to `maxFeePerGas` and `maxPriorityFeePerGas`, in bigint arithmetic
(multiply first, divide by 100 last).

**Division rounds up, and every escalated fee is strictly greater than the fee it replaces.** Both
clauses exist for the same reason and neither is cosmetic. Bigint division truncates, so on a small
enough fee a percentage increase can round away entirely — `1n x 150n / 100n` is `1n`, an
"escalation" that produces the identical price the network already rejected as an insufficient
bump. That is the exact failure this ADR exists to remove, reappearing at the bottom of the number
range rather than the top. Ceiling division fixes the common case; the `previous_attempt_fee + 1n`
floor is what guarantees the property outright, so monotonicity does not depend on the configured
percentages being large enough to survive truncation. The floor is applied **before** the
`original_fee x MAX_MULTIPLE` clamp, so the cap still binds: once escalation reaches the ceiling,
attempts stop increasing and hold there, which is point 2's clamp-and-continue behaviour and not a
licence to creep past the cap by one wei per pass.

Three properties, each doing a distinct job:

- **The base is the previous attempt's actual fee.** This is what makes the curve a curve. Because
  `ESCALATION_PCT` is validated to be comfortably above the provider minimum, every attempt clears
  the required bump *by construction*, on a flat oracle as much as a rising one. The status quo's
  central defect is fixed by the choice of base, not by the choice of number.
- **The oracle is a floor, not the base.** If the market moved more in one stuck interval than our
  curve would have moved, we take the market's number immediately rather than climbing to it over
  several 90-second passes. This is the useful half of the fee-oracle option, kept.
- **The cap is a multiple of the original fee.** Expressing it relative to what the transaction was
  originally willing to pay keeps it meaningful across chains and across fee regimes, in a way an
  absolute wei ceiling would not.

Why a curve rather than a constant, stated in terms of what each attempt is *for*: the first
replacement is a bid that the original was merely unlucky or marginally underpriced — most stuck
transactions clear here, so opening cheap is right. Each subsequent attempt is evidence that the
first hypothesis was wrong and the gap between our price and the clearing price is larger than we
guessed. Since we do not know how much larger, and since our information after each failure is
strictly worse than we thought it was, closing the gap by a constant increment converges too slowly
when it matters most. A geometric curve searches an unknown magnitude in a bounded number of steps,
which is the shape of the problem.

### 2. Exhaustion clamps; it does not stop

When escalation reaches the cap and the transaction still has not mined, the reconciler **keeps
replacing at the cap** rather than giving up on the nonce.

This is the point where nonce hygiene and intent delivery separate, and they deserve different
answers:

- **Clearing the nonce never stops.** The nonce blocks every higher nonce on the shared wallet.
  Abandoning it is exactly incident #54, which is the thing ADR-0040's reconciler was built to make
  impossible without an operator. Continuing to bid the cap costs 21,000 gas per stuck interval and
  eventually lands when the spike passes; stopping costs a platform-wide relayer outage that ends
  only when a human notices. There is no version of this where stopping is the better trade.
- **Delivering the intent stops at `validBefore`.** Past the deadline `TaskMarketForwarder.relay`
  reverts `ReceiptExpired`, so any gas spent trying to make that payload land is spent on something
  the contract will refuse. ADR-0050 already forbids re-dating the receipt, so the deadline is a
  fixed, chain-enforced fact rather than something we could extend by choosing to.

Both hold at once because they are different transactions. Once an intent's `validBefore` has
passed, a *rebroadcast of the original* is pointless and must stop — but the *cancel* (the zero-value
self-transfer) is not delivering anything and must continue until the nonce is free. Indeed, after
the deadline the cancel becomes the strictly preferred action: it is cheap, it is terminal, and it
produces the confirmed-replacement evidence ADR-0045 requires to settle the intent as failed. So the
deadline does not end escalation; it converts a speed-up into a cancel.

**This applies only to an intent that actually holds a nonce.** A cancel exists to free a nonce, so
there has to be one. An intent still in `recorded` with `server_wallet_transaction_id IS NULL` was
never allocated a nonce — ADR-0050 point 4's positive evidence that nothing was ever signed — so it
occupies nothing, blocks nothing, and has nothing to cancel. Broadcasting a self-transfer for it
would spend a *fresh* nonce to clear a nonce that does not exist. Such an intent goes straight to
terminal settlement instead: marked failed with its reason, its guard released, and its payment
refunded if it carries one, exactly as ADR-0050 point 6 describes. The deadline-converts-a-speed-up-
into-a-cancel rule is therefore scoped to intents with an allocated nonce; for the rest, the
deadline simply ends the intent.

Escalation therefore has no attempt limit of its own. `validBefore` bounds retry of the payload; the
cap bounds the price; nothing needs to bound the count, and adding one would only reintroduce the
abandoned-nonce failure the cap was designed to avoid.

### 3. Cancel and speed-up share one policy

The reconciler today only cancels. ADR-0040 records rebroadcasting the original as a possible future
capability. When that lands, **it uses this same curve, cap and floor** — one policy, not two.

The argument for one policy is that the quantity being escalated is set by the mempool, not by the
payload. What price clears is a property of the network at that moment, and it is identical for a
21,000-gas self-transfer and a 300,000-gas relay at the same nonce. Two curves would encode a
difference that does not exist in the thing being modelled.

The real difference between the two acts is absolute cost, not price: at the same fee-per-gas, a
speed-up of a large call costs an order of magnitude more ETH than a cancel. Expressing the cap as a
*multiple of the original fee* rather than an absolute ETH budget handles this correctly without a
second policy — the multiple bounds how far above its own original price each transaction may be
pushed, which is the comparable quantity. If operating evidence later shows a speed-up's absolute
cost needs a tighter bound than a cancel's, that is a second cap on an existing curve, added then,
against real numbers. Building two policies now for a path that does not yet exist would be
speculating about a difference we have never measured.

### 4. Configuration surface

Four variables in `apps/backend/src/config/env.ts`, following the existing
`z.coerce.number()`-with-a-default pattern used by `DEFAULT_PLATFORM_FEE_BPS`, `TRUST_PROXY_HOPS`
and the rest:

| Variable | Default | Validation | Meaning |
| --- | --- | --- | --- |
| `REPLACEMENT_GAS_FIRST_BUMP_PCT` | `200` | `int`, `min(110)` | Opening bid as a percentage of the live oracle. `200` preserves today's 2x behaviour exactly, so adopting this decision changes nothing about the first attempt. |
| `REPLACEMENT_GAS_ESCALATION_PCT` | `150` | `int`, `min(125)` | Each attempt as a percentage of the previous attempt's fee. |
| `REPLACEMENT_GAS_MAX_MULTIPLE` | `10` | `int`, `min(2)` | Ceiling, as a multiple of the original transaction's fee. |
| `REPLACEMENT_GAS_MAX_FEE_WEI` | unset | `int`, `positive`, optional | Optional absolute per-gas ceiling, applied after the multiple. An operator's circuit breaker for a fee regime nobody anticipated; unset by default because a wei value is meaningless without knowing the chain. |

The dangerous misconfiguration is a cap that sits below the opening bid: the first attempt is then
clamped on the way out, the curve flattens into the status quo — the exact defect this ADR exists to
remove — and every individual value still looks reasonable in isolation.

**That check cannot be made at boot, and attempting it there is worse than not making it.** The cap
is `original_fee x MAX_MULTIPLE` and the opening bid is `oracle x FIRST_BUMP_PCT / 100`. These are
multiples of two different quantities: the fee this specific transaction was originally broadcast
with, and whatever the oracle reads at the moment of replacement. Comparing `MAX_MULTIPLE x 100`
against `FIRST_BUMP_PCT` compares a multiple of the original fee against a percentage of the
oracle — two different bases, so the comparison is not meaningful and does not catch the case it is
aimed at. Whether the cap clamps the opening bid depends entirely on how far the oracle has moved
since the original broadcast, which no boot-time value knows. A boot check here would be worse than
none: it would pass on every sensible configuration and thereby imply a guarantee it never provided.

**So the validation is per transaction, at replacement time.** When a replacement fee is computed,
if the `original_fee x MAX_MULTIPLE` cap would clamp the fee below the oracle-derived opening bid —
that is, if the cap alone prevents the attempt from clearing what the market currently says is
sufficient — the replacement is priced at the cap and **the clamp is recorded and logged as a named
condition**, distinct from an ordinary capped attempt. It is not a boot failure and it does not stop
the replacement: point 2 is explicit that clearing the nonce never stops, and refusing to send is
strictly worse than sending an underpriced attempt. What it is, is the signal that this deployment's
`REPLACEMENT_GAS_MAX_MULTIPLE` is too low for the fee regime it is now operating in, surfaced at the
moment it becomes true rather than inferred afterwards from a nonce that would not clear. That is
the alert an operator needs, and it is the same signal as "a nonce has reached the cap and stayed
there", which the follow-ups below already name as unbuilt.

The per-value validations in the table above stand and are genuine boot checks — `min(110)`,
`min(125)`, `min(2)` each rule out a value that is wrong on its own terms, independent of any
runtime quantity.

`min(125)` on the escalation percentage is deliberate and load-bearing: the provider minimum is
around 10%, and validating at 25% keeps every attempt clear of it with room for rounding in bigint
division and for a provider that is stricter than the usual. A value below that would produce
attempts the network rejects, which is the status quo's bug expressed as a configuration value, so
the schema refuses it rather than trusting the operator to know.

### 5. The defaults are Base's defaults, and the ADR says so

`CHAIN_ID` defaults to `8453` and Base is what runs today, so these numbers were chosen against
Base's fee dynamics: a low, slow-moving base fee where a 10x ceiling on a 21,000-gas self-transfer
is an affordable worst case and an aggressive posture is close to free. **They are not proposed as
universal.** An Ethereum mainnet deployment should expect to lower `REPLACEMENT_GAS_MAX_MULTIPLE`
and probably set `REPLACEMENT_GAS_MAX_FEE_WEI`, because the same multiple there is real money. That
tuning is an operational act on a deployment, requiring evidence from that chain and not another
ADR.

## Consequences

**Positive:**

- Each replacement attempt is genuinely more competitive than the last, and clears the provider's
  minimum bump by construction rather than by luck of the oracle having moved.
- The "replacement rejected as underpriced, forever" loop — which spends passes and log volume while
  putting nothing new on the network — cannot occur.
- A chain-wide fee jump is matched in one pass via the oracle floor, not approached over several.
- The worst-case spend on any one nonce is a number an operator can compute in advance from the
  original fee and the cap, instead of being whatever the market does.
- Base and Ethereum mainnet can run the same code with appropriate numbers, and the numbers can be
  changed during an incident without a deploy.
- A misconfiguration that would flatten the curve back to the status quo is detected and reported by
  name at the moment it actually bites, rather than degrading silently. It cannot be caught at boot,
  because whether it bites depends on how far the oracle has moved since the original broadcast.
- Adopting this changes nothing about the common case: the first replacement is still 2x the oracle,
  which is what ships today. The new behaviour only appears on the second and later attempts, which
  are the attempts that are currently broken.

**Negative / trade-offs:**

- Four environment variables and a runtime clamp check where there was one constant. Configuration is
  a place bugs live, and the most dangerous misconfiguration here is one that looks fine at boot and
  only reveals itself against a fee regime the operator did not anticipate.
- `sendReplacement(nonce)` must learn what the previous attempt paid, which means reading it back
  from the `server_wallet_transactions` row. The current signature does not carry it, and the fee
  actually used per attempt may need persisting if it is not already recoverable — a schema change
  in the ADR-0040 outbox.
- We will sometimes overpay for gas, knowingly. During a spike the curve can outrun the clearing
  price and land a transaction that a more patient policy would have got cheaper. That is the chosen
  direction of error: the alternative is a stalled shared relayer, and the asymmetry between "some
  wasted ETH on 21,000-gas transactions" and "no paid write on the platform completes" is not close.
- Clamping-and-continuing rather than stopping means a genuinely pathological chain state produces an
  indefinite series of capped replacements. Bounded per attempt, unbounded in count. Alerting on
  replacement frequency — already an open follow-up from ADR-0040 — matters more under this decision
  than it did before.
- The interaction of the cap with `validBefore` is subtle enough that it needs a test rather than a
  comment: a speed-up must stop at the deadline while a cancel at the same nonce must not.

**Neutral / follow-up:**

- **Decided, not open: the fee actually used is persisted on the outbox row.** Escalation multiplies
  the fee being replaced, not a freshly read oracle, so each attempt needs to know what the previous
  attempt actually paid. `sendReplacement(nonce)` cannot see that today. The value belongs on the
  ADR-0040 `server_wallet_transactions` row alongside the nonce and hash it already carries, written
  when the transaction is broadcast and read by the next escalation. Reading the oracle again in its
  place is what produces the status-quo defect this ADR exists to fix.

- Whether the per-attempt fee history belongs on the `server_wallet_transactions` row or a child
  table is an implementation detail, not a decision. The requirement is only that attempt *n* can
  read attempt *n-1*'s fee and the original's.
- A dry-run or observability surface showing the fee ladder a given configuration produces would
  make the numbers reviewable without an incident. Not built, worth having.
- ADR-0040's follow-up of storing the signed raw transaction so the reconciler can rebroadcast the
  original rather than cancel it is still open. This decision is written so that it needs no
  amendment when that lands: the policy already covers both acts, and only the deadline check
  distinguishes them.
- Alerting on a nonce that has reached the cap and stayed there across several passes is the signal
  that distinguishes "congested" from "something else is wrong". It does not exist yet.
- The stuck threshold itself (`DEFAULT_STUCK_AFTER_MS`, 90s) is not touched here. It sets how often
  the curve steps, so it and the escalation percentage together determine how fast the fee climbs in
  wall-clock time. Retuning it is an operational constant of the same kind as the others, but a
  reader changing one should look at the other.

## References

- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
  — the reconciler and replacement path this extends
- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
  — a replacement mined at the same nonce is confirmed evidence the work did not happen
- [ADR-0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
  — gas is the only mutable field of a relayed write, and `validBefore` is immutable and
  chain-enforced; this ADR is the gas follow-up it names
- `apps/backend/src/lib/wallet.ts` — `sendReplacement` and `REPLACEMENT_GAS_MULTIPLIER`
- `apps/backend/src/lib/server-transaction-reconciler.ts` — `replaceStuckNonce`,
  `DEFAULT_STUCK_AFTER_MS`
- `apps/backend/src/config/env.ts` — the `z.coerce.number()` default-and-validate pattern the four
  variables follow
- `packages/contracts/src/TaskMarketForwarder.sol` — `relay`'s `ReceiptExpired` check, the bound
  that converts a speed-up into a cancel
