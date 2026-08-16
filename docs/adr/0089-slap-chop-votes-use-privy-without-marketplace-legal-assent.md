# 0089 — Slap-Chop votes use Privy without marketplace legal assent

> **Decision (Y-statement):** In the context of lightweight social ordering for a free game
> catalog, facing the existing default-deny legal gate for marketplace writes and the need to resist
> duplicate vote manipulation without introducing wallet friction, we decided to authenticate
> `games.vote` with Privy identity and explicitly exempt only that procedure from marketplace legal
> acceptance while applying shared per-user and trusted-IP rate limits, to achieve reversible
> one-person-per-game voting with anonymous browsing and play, accepting a narrowly maintained
> exemption in the legal middleware.

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
- **Amends / Amended-by:** Amends ADR-0009
- **Pending Amends / Amended-by:** —

## Context

ADR-0009 correctly makes new backend writes require versioned marketplace legal acceptance unless
they are explicitly exempt. A Slap-Chop vote does not create, bid on, submit to, evaluate, dispute,
fund or settle a task. Requiring the marketplace acceptance flow would add a wallet-oriented legal
step to the first casual vote and conflict with the product decision that browsing and playing are
anonymous and voting needs only lightweight sign-in.

Votes still need a stable server-verifiable identity, atomic replacement/removal and abuse limits.
The repository already verifies Privy bearer tokens and has a shared rate-limit module. Exempting a
whole router or trusting a browser-provided identity would make the legal and integrity boundaries
broader than the product requires.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Privy-authenticated vote with an exact legal exemption and shared rate limits** (chosen) | Minimal first-vote friction; stable identity; keeps ADR-0009 fail-closed for every other new write | Adds one exact exemption that route renames must keep synchronized |
| Require full marketplace legal acceptance before voting (rejected) | Reuses the default path with no exemption | Treats a non-economic catalog reaction like marketplace participation and undermines the lightweight game product |
| Require a connected wallet signature but no legal receipt (rejected) | Sybil cost may be somewhat higher | Introduces wallet friction without payment or ownership need; diverges from the existing Privy web identity |
| Allow anonymous cookie/IP voting (rejected) | Lowest immediate friction | Easy to reset or spoof; cannot enforce one vote per user or restore selected state across devices |
| Exempt all `games.*` and `gameCuration.*` writes (rejected) | Fewer allowlist entries | Broadens the exception beyond the approved casual vote and could silently exempt future economic or privileged actions |

## Decision

Catalog listing, detail and play remain anonymous. `games.vote` requires a backend-verified Privy
access token and uses its exact `user_id` as the canonical voter identity. It requires neither a
wallet, X402 payment nor `X-Taskmarket-Legal-Receipt`. The legal middleware adds only the exact REST
route and tRPC procedure names needed for this vote mutation to its explicit exemption allowlists.

The exemption is from Taskmarket's versioned marketplace-participation acceptance flow, not from
the service's generally published terms or privacy notice. Curator mutations and any future game
write remain protected by ADR-0009's default unless another accepted decision explicitly exempts
them.

Each user has at most one vote per game with value `1` or `-1`. Repeating the active value removes
the row; choosing the opposite value changes it. The vote row and cached counters update in one
transaction. Shared sliding-window rate limiting applies independently to the verified user ID and
the client IP derived under the deployed trusted-proxy configuration. Rate-limit storage failures
fail closed for vote writes.

## Consequences

**Positive:**

- Visitors can discover and play without identity, and the first social action needs only Privy
  sign-in.
- One exact exemption preserves the default-deny behavior for unrelated and future writes.
- Server identity, uniqueness and transactional counters make normal duplicate/concurrent votes
  deterministic.
- The implementation reuses audited Privy and rate-limit boundaries.

**Negative / trade-offs:**

- Privy accounts are not proof of unique humans, so organized account creation can still influence
  ranking.
- The exemption allowlist must change with a vote route rename or the endpoint safely becomes
  unavailable behind legal acceptance.
- IP limiting can affect shared networks and depends on correct trusted-proxy configuration.

**Neutral / follow-up:**

- Downvotes affect order but never unpublish; curation remains the safety boundary.
- Stronger anti-abuse measures require observed production need and must not silently add wallet or
  tracking requirements.

## References

- [ADR-0009 — Legal acceptance uses default-deny middleware](0009-legal-acceptance-opaque-receipt-default-deny-middleware.md)
- [ADR-0038 — Rate limiting lives in one shared module](0038-rate-limiting-is-a-shared-module-not-per-feature-bespoke-logic.md)
- [RFC 0009 — Slap-Chop Games catalog](../rfc/0009-slap-chop-games-catalog.md)
- [Wayfinder M0 #554](https://github.com/daydreamsai/taskmarket/issues/554)
