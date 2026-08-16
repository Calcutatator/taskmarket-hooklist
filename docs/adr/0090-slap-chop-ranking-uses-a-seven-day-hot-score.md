# 0090 — Slap-Chop ranking uses a seven-day Hot score

> **Decision (Y-statement):** In the context of ordering a small curated game catalog by community
> interest, facing the tension between durable quality and enough turnover for new games to be
> discovered, we decided to rank published games with a backend-owned Reddit-style Hot score using
> a 604,800-second age divisor and deterministic tie-breaks, with a production rollback to newest
> order, to achieve vote-sensitive weekly turnover without behavioral tracking, accepting that the
> launch constant will need evidence-based review as catalog volume grows.

- **Status:** Accepted
- **Date:** 2026-08-16
- **Accepted:** 2026-08-16
- **Embodiment:** Verified
- **Last audited:** 2026-08-16
- **Author:** Codex
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Oscar Mander-Jones — explicit approval in Conductor on 2026-08-16
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Pure vote totals cause established entries to remain at the top indefinitely; newest-first ignores
the social curation requested for the product. Play counts are available without sign-in and are
therefore cheaper to manipulate, while adding them would create a behavioral tracking policy the
MVP does not need. Reddit's archived Hot algorithm provides a simple monotonic combination of net
votes and age, but its roughly 12.5-hour divisor turns over much faster than a durable game catalog
should.

Ranking must be identical for every client, stable under pagination and testable independently of
database query accidents. Operators also need a safe fallback if launch traffic exposes a score or
query defect.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Seven-day Reddit-style Hot score in one backend module, with newest-order rollback** (chosen) | Balances votes and discovery; deterministic and inexpensive; rollback does not rewrite data | The divisor is an informed launch choice rather than production-derived tuning |
| Reddit's original 45,000-second divisor (rejected) | Battle-tested formula and fast turnover | Appropriate to news posts, but ten votes offset only hours rather than roughly a week |
| Net votes descending (rejected) | Easiest to explain | Entrenches early winners and gives new games little exposure |
| Newest first (fallback only) | Predictable discovery and safe operational fallback | Ignores the requested social ordering when used as the primary mode |
| Include play counts or personalized signals (rejected for MVP) | More behavioral evidence and potential relevance | Easier to manipulate anonymously; adds tracking, privacy and recommendation complexity |

## Decision

The Ranking module computes, for each published game:

```text
net = upvotes - downvotes
magnitude = log10(max(abs(net), 1))
hot = sign(net) * magnitude + (publishedAt - 2026-01-01T00:00:00Z) / 604800
```

Ties sort by net votes descending, publication time descending and stable game ID ascending. A
catalog in which every game has zero votes therefore sorts newest first. Fixed vectors cover zero,
positive and negative net values, vote monotonicity, age offsets and all tie-breakers.

The backend owns score calculation and ordering; clients receive ordered entries and display
scores and do not reproduce the formula. Results do not reorder underneath an active catalog
session. New ranking takes effect on navigation, search or refresh.

`SLAP_CHOP_RANKING_MODE` is a closed operational switch with values `hot` and `new`, defaulting to
`hot`; malformed values fail configuration validation. The production release owner may set `new`
and redeploy as a rollback without altering vote data. Changing the formula, epoch, divisor or
tie-breaks requires Taskmarket product-owner approval and a decision amendment; the backend owner
is responsible for implementation and vector updates.

## Consequences

**Positive:**

- Roughly ten net votes offset one week of age, giving strong games durability without permanently
  freezing the grid.
- One pure backend seam and fixed vectors prevent ranking drift between SQL and browser code.
- Newest-order rollback is understandable, reversible and preserves all votes.
- The MVP does not need play tracking or personalized profiles.

**Negative / trade-offs:**

- The launch divisor may turn over too quickly or too slowly at real catalog scale.
- A timestamp component means scores are not intuitive raw vote totals even though the UI displays
  net votes.
- Operational mode changes require a configuration update and redeploy.

**Neutral / follow-up:**

- Review the divisor only after enough catalog and vote history exists to compare rank stability
  and discovery.
- A future Best view or user-selectable ordering is a separate product proposal.

## References

- [RFC 0009 — Slap-Chop Games catalog](../rfc/0009-slap-chop-games-catalog.md)
- [Wayfinder M0 #554](https://github.com/daydreamsai/taskmarket/issues/554)
- [Reddit archived ranking implementation](https://github.com/reddit-archive/reddit/blob/master/r2/r2/lib/db/_sorts.pyx)
