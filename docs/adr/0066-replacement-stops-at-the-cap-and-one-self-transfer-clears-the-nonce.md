# 0066 — Replacement stops at the cap, and a single self-transfer clears the nonce

> **Decision (Y-statement):** In the context of replacing a stuck server-wallet transaction, facing
> a rule that says to keep replacing at the cap when a same-priced replacement is refused by every
> node, we decided that escalation stops at the cap and the nonce is cleared by one cheap
> self-transfer priced above it, to achieve a bounded worst case that still unblocks the queue
> without an operator, accepting that exactly one transaction per stuck nonce may exceed the
> configured ceiling.

- **Status:** Accepted
- **Date:** 2026-08-05
- **Accepted:** 2026-08-05
- **Embodiment:** Verified
- **Last audited:** 2026-08-05
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0051

## Context

ADR-0051 established geometric replacement-fee escalation under a cap expressed as a multiple of
the original fee. Two of its statements cannot both hold.

It rejects the flat-multiplier option because an unchanged price is refused:

> Produces an identical price on a flat oracle, which providers reject as an insufficient bump, so
> the "retry" can consist entirely of rejected sends.

And then prescribes exactly that at the ceiling:

> once escalation reaches the ceiling, attempts stop increasing and hold there... not a licence to
> creep past the cap by one wei per pass

with point 2 stating the reconciler "keeps replacing at the cap rather than giving up on the
nonce". A replacement at the fee it is replacing is not a replacement. Nodes enforce a minimum
price bump, so every such send is refused: the reconciler burns a pass per interval and the nonce
never clears.

The implementation silently took the other branch — exceeding the cap to preserve monotonicity —
and `apps/backend/test/integration/replacement-gas-escalation.test.ts` still asserts the ADR's
version (`expect(fee).toBeLessThanOrEqual(ceiling)` and `expect(previousFee).toBe(ceiling)`). CI
provides Postgres and `DATABASE_URL`, so that test does run and the branch is red. Code, test and
ADR are three different answers.

Underneath the inconsistency is a constraint of the chain, not of this codebase. Ethereum executes
an account's transactions in strict nonce order, and there is no protocol-level cancel. A pending
transaction at nonce N blocks every later nonce, and clears only when it mines, when something else
mines at that nonce, or when every mempool drops it. "Cancelling" a transaction — in MetaMask or
anywhere else — means broadcasting a replacement at the same nonce with a higher fee; the option
that merely clears local history does not touch the network at all.

So a hard fee ceiling and a guarantee that the nonce clears without an operator are in direct
tension. ADR-0051 tried to keep both and, in keeping both, kept neither.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Stop escalating at the cap; clear the nonce with one self-transfer priced above it** (chosen) | Bounded: the work is never bid above the ceiling, and the overspend is one 21,000-gas transfer per stuck nonce, not an open-ended climb; the queue clears with no operator; the intent settles through the existing mined-replacement rule with no new settlement path; matches what every wallet calls "cancel" | One transaction per stuck nonce exceeds the configured cap, so the cap bounds the *work*, not literally every send |
| B. Keep replacing at the cap, as ADR-0051 currently states (rejected) | No change to the written decision | Cannot work. A same-priced replacement is refused by every node, so this is a loop of rejected sends that never clears the nonce, while ADR-0051 rejects another option for precisely this reason |
| C. Exceed the cap indefinitely to preserve monotonicity (rejected — current code) | The nonce always clears eventually | The cap stops bounding anything, which was its whole purpose. An operator can no longer reason in advance about the worst case, and a stuck transaction during a fee spike can climb without limit |
| D. Stop at the cap and page an operator (rejected) | Never exceeds the ceiling by a single wei | Converts an automatic recovery into a manual one, and the queue stays jammed until a human acts. It trades an outage for a rounding error |

## Decision

Escalation stops at the cap. The reconciler does not send a replacement priced at or below the one
it is replacing.

When a stuck transaction reaches the cap, the reconciler sends **one** zero-value self-transfer at
that nonce, priced above the cap by whatever margin the provider's minimum bump requires. That
transfer clears the nonce and unblocks everything queued behind it. The intent settles as failed
through the existing mined-replacement rule — a replacement that occupies the nonce is already one
of the accepted forms of confirmed evidence, so no new settlement path is introduced.

ADR-0051's point 2 is amended: "keeps replacing at the cap" becomes "stops replacing at the cap and
clears the nonce once". Its clamp-and-continue paragraph is amended to match. The escalation
policy, the oracle floor and the cap-as-multiple-of-original all stand unchanged.

## Consequences

**Positive:**

- The stated rule becomes one the network will actually execute. No configuration produces a loop
  of refused sends.
- The worst case stays bounded and stays reasonable about in advance: the escalation ladder up to
  the ceiling, plus one 21,000-gas transfer.
- The queue clears without an operator, which is the property point 2 was reaching for.
- Code, test and ADR converge on one answer, and the red integration test goes green by being
  corrected rather than deleted.

**Negative / trade-offs:**

- The cap is no longer literally inviolable. It bounds what is paid for the work; one clearing
  transfer per stuck nonce sits above it. An operator reading "cap" must understand it that way,
  which is why this is written down rather than left as a code comment.
- A self-transfer at the stuck nonce means the original transaction is definitively abandoned. If
  it would have mined moments later, the work is lost and the payment refunded, correctly, through
  the confirmed-evidence rule. The stuck threshold is what makes that unlikely, not impossible.
- One more transaction type the reconciler can emit, which the outbox and any log analysis must
  distinguish from real work.

**Neutral / follow-up:**

- `apps/backend/src/lib/replacement-gas.ts` currently reports a `cappedBelowPreviousFee` signal for
  the case where the clamp would break monotonicity. Under this decision that case is the trigger
  to stop and clear rather than to exceed, so the signal keeps its meaning and changes its
  consumer.
- The integration test's assertions change from "holds at the ceiling forever" to "stops at the
  ceiling, then one clearing transfer above it".
- Nothing here changes the escalation curve, the oracle floor, or how the cap is configured.

## References

- `docs/adr/0051-replacement-gas-escalates-geometrically-under-a-configured-cap.md` — the decision
  amended here.
- `apps/backend/src/lib/replacement-gas.ts` — the escalation policy.
- `apps/backend/src/lib/server-transaction-reconciler.ts` — where replacement is driven.
- `apps/backend/test/integration/replacement-gas-escalation.test.ts` — currently asserting the
  superseded rule.
