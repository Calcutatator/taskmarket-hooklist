# 0002 — Merging to `main` automatically deploys app code to the shared testnet

> **Decision (Y-statement):** In the context of the agentic development factory's branch and
> release flow, facing the question of how code reaches the shared testnet and mainnet without
> adding a second long-lived branch to manage, we decided to keep `main` as the sole PR target
> and default branch, with every merge automatically deploying app code
> (backend/frontend/docs) to the shared testnet Railway environment, and `make release`
> promoting that same validated commit to production on a separate, manual, tag-gated step —
> to achieve a real staging step before mainnet without the process weight of a second branch
> and a manual merge-forward, accepting that testnet now deploys on every merge to `main`
> whether or not that specific change touches anything testnet-relevant.

- **Status:** Accepted
- **Date:** 2026-07-15
- **Accepted:** 2026-07-15
- **Embodiment:** Implemented
- **Last audited:** 2026-07-30
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Realized by:** .github/workflows/deploy-testnet.yml@2ae727d2b53deb3d1e39ff1e20693cb54070bef6

## Context

Before this decision, PRs targeted `main` directly, and Railway's environment naming was
itself confusing: an environment literally named `production` was actually the persistent
shared testnet chain (serving `testnet-market.daydreams.systems`), while the real production
environment was named `taskmarket.io`. Nothing deployed to the shared testnet automatically —
`deploy-production.yml` (formerly `deploy.yml`) only deploys on a `v*` tag to real production.

An earlier version of this ADR proposed a separate long-lived `testnet` branch as the default
PR target, with `main` as a production mirror updated only by a manual merge from `testnet`
(matching an aspirational branch model already sketched in
`docs/rfc/0003-agentic-development-factory.md`). That branch was created, the repository's
default branch was flipped to it, and this PR was retargeted to it — then reverted before
merge: the manual `testnet` → `main` merge-forward step added process weight without a
corresponding safety benefit, since nothing about promoting already-validated app code to
production requires a second branch to gate it. `main` returned to being the default branch
and PR target; the `testnet` branch this session created was deleted.

The Railway-side cleanup from that same session stands independent of which git branch drives
it: the misnamed `production` environment was renamed to `testnet` (already had the correct
`testnet-*.daydreams.systems` domains, so no DNS change was needed), and a stray empty
duplicate `testnet` environment with the wrong domain was deleted.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Single `main` branch; merge auto-deploys to testnet, `make release` promotes to production | No second branch to keep in sync; no manual merge-forward step; testnet always reflects what's actually on `main` | Testnet redeploys on every merge, including changes that don't touch testnet-relevant code; no "batch of PRs is now locked in for this testnet cycle" checkpoint |
| Separate `testnet` branch as PR target and default, `main` as a manually-updated production mirror (the originally proposed, then reverted, design) | Real lock-in checkpoint before testnet; `main`'s tip only ever reflects validated, promoted code | Extra manual merge-forward step for every batch of work; a second long-lived branch to keep straight; existing tooling/mental model already assumes `main` is where PRs land |
| Auto-merge `main` into a separate `testnet` branch (or vice versa) via a bot on every push (rejected) | Removes the manual merge step while still having two branches | Two branches with no distinct purpose between them — strictly worse than just using one |

## Decision

`main` stays the repository's default branch and sole PR target — no separate `testnet`
branch. Every merge to `main` triggers `ci.yml`'s `quality` job; once that succeeds,
`.github/workflows/deploy-testnet.yml` fires via a `workflow_run` trigger on `ci.yml`'s
completion (not the same push event CI itself runs on, since checking "did CI pass" on that
same event would race `quality`'s multi-minute runtime and abort every deploy). It deploys
`@taskmarket/backend`, `@taskmarket/frontend`, and `@taskmarket/docs` to the Railway `testnet`
environment (renamed from a misleading `production` label) — no Anvil, no contract deploy. A
testnet contract upgrade (`make upgrade testnet`) stays a separate, manual, developer-run
step, exactly like mainnet (ADR-0001) — this ADR does not change contract-upgrade custody or
automation, only the app deploy path.

When a developer is satisfied with what's live on testnet, `make release` tags that same
commit and `deploy-production.yml` deploys it to real production (`taskmarket.io`), gated on
CI passing and a `v*` tag push, exactly as it worked before this ADR.

## Consequences

**Positive:**
- A real, exercised staging step exists before mainnet: testnet redeploys automatically on
  every merge, giving a live environment that reflects what's actually on `main`.
- No second long-lived branch to keep in sync, no manual merge-forward step, no risk of
  `main` and a `testnet` branch drifting apart.
- Contract-upgrade custody is untouched: testnet and mainnet upgrades both stay manual,
  developer-run actions (this ADR only automates the app-code deploy, never contracts).

**Negative / trade-offs:**
- Testnet redeploys on every merge to `main`, including changes with nothing to do with
  testnet (e.g. a docs-only or CLI-only PR) — there's no batching or lock-in checkpoint.
- Anyone reasoning about "what's on testnet right now" needs to just check `main`'s tip
  directly rather than a separate branch that represents a deliberate snapshot.

**Neutral / follow-up:**
- None outstanding — `docs/rfc/0003-agentic-development-factory.md`'s release-ladder section
  was updated alongside this ADR to describe this single-branch model.

## References

- RFC: `docs/rfc/0003-agentic-development-factory.md` (release path section)
- RFC: `docs/rfc/0002-agent-preview-environments.md`
- ADR-0001: `docs/adr/0001-mainnet-upgrades-stay-manual.md` (mainnet upgrade custody, unchanged
  by this decision)
- `.github/workflows/deploy-testnet.yml`, `.github/workflows/deploy-production.yml`,
  `.github/workflows/deploy-preview.yml`
